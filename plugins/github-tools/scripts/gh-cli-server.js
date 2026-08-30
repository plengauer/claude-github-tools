#!/usr/bin/env node
'use strict';

/**
 * "GitHub CLI" MCP server: exposes a single tool, `gh`, that runs the
 * `gh` CLI with caller-supplied arguments and optional stdin, and
 * returns stdout, stderr, and the exit code as separate fields.
 *
 * SECURITY: the executable is hardcoded below and is never taken from
 * tool input -- a call can only supply argv[1:] (the arguments after
 * `gh`) and stdin content, never the program name. Arguments are
 * passed as an array to child_process.spawnSync with shell left at
 * its default of false (never set true here), so the OS receives each
 * argument as a literal string -- execve() on POSIX, or Node's own
 * argv-to-command-line escaping for CreateProcess on Windows -- with
 * no shell in between to reinterpret quotes, `;`, `|`, `$()`,
 * backticks, etc. That's what makes this injection-safe without any
 * manual escaping: do not add `shell: true` to this file, and do not
 * build a command string and pass it to a shell.
 *
 * `gh auth` is a per-user, machine-global credential (~/.config/gh or
 * the OS keychain/secure storage), not per-directory, so this simply
 * inherits whatever the person already has `gh auth login`'d into --
 * it runs with their identity and whatever scopes that token has.
 *
 * Only the official `gh` binary is expected on PATH here. If a
 * non-standard install shims `gh` as a Windows .cmd/.bat file instead
 * of a native .exe, spawnSync without shell:true may fail to launch it
 * (a known Node/Windows limitation) -- not handled specially here.
 */

const { spawnSync } = require('child_process');
const readline = require('readline');

const GH_EXECUTABLE = 'gh'; // hardcoded; never derived from tool input
const MAX_BUFFER = 10 * 1024 * 1024; // 10MB, to avoid truncating large gh output

const TOOL_NAME = 'gh';
const TOOL_DEFINITION = {
  name: TOOL_NAME,
  description:
    'Runs the `gh` (GitHub CLI) command with the given arguments and optional stdin. ' +
    'Uses whatever GitHub account is already authenticated via `gh auth login` on this machine. ' +
    'Do not include "gh" itself in args.',
  inputSchema: {
    type: 'object',
    properties: {
      args: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Arguments to pass to gh, e.g. ["pr", "list", "--repo", "owner/repo"]. Each array element is exactly one argv entry -- do not put multiple arguments in a single string.',
      },
      stdin: {
        type: 'string',
        description: "Optional text written to the command's stdin, e.g. for `gh pr create --body-file -`.",
      },
    },
    required: ['args'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      stdout: { type: 'string' },
      stderr: { type: 'string' },
      exit_code: { type: 'number' },
    },
    required: ['stdout', 'stderr', 'exit_code'],
  },
};

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function runGh(args, stdinText) {
  const result = spawnSync(GH_EXECUTABLE, args, {
    input: stdinText,
    encoding: 'utf8',
    shell: false,
    maxBuffer: MAX_BUFFER,
  });

  if (result.error) {
    // e.g. gh not found on PATH. Surface it in the same shape as a
    // failed command rather than throwing, so the caller always gets
    // stdout/stderr/exit_code back.
    return {
      stdout: result.stdout || '',
      stderr: result.error.message,
      exit_code: typeof result.status === 'number' ? result.status : -1,
    };
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exit_code: result.status === null ? -1 : result.status,
  };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore malformed input
  }
  if (msg.id === undefined) return; // notification, no response expected

  switch (msg.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: (msg.params && msg.params.protocolVersion) || '2025-06-18',
          serverInfo: { name: 'github-cli', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      });
      break;
    case 'tools/list':
      send({ jsonrpc: '2.0', id: msg.id, result: { tools: [TOOL_DEFINITION] } });
      break;
    case 'tools/call': {
      const params = msg.params || {};
      const toolArgs = params.arguments || {};
      if (params.name !== TOOL_NAME) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32602, message: `Unknown tool: ${params.name}` },
        });
        break;
      }
      const args = Array.isArray(toolArgs.args) ? toolArgs.args.map(String) : null;
      if (!args) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32602, message: '"args" must be an array of strings' },
        });
        break;
      }
      const stdinText = typeof toolArgs.stdin === 'string' ? toolArgs.stdin : undefined;
      const outcome = runGh(args, stdinText);
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [
            {
              type: 'text',
              text: `exit code: ${outcome.exit_code}\n\n--- stdout ---\n${outcome.stdout}\n--- stderr ---\n${outcome.stderr}`,
            },
          ],
          structuredContent: outcome,
          isError: outcome.exit_code !== 0,
        },
      });
      break;
    }
    case 'ping':
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
      break;
    default:
      send({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      });
  }
});
