#!/usr/bin/env node
'use strict';

/**
 * MCP stdio server wrapping the `gh` CLI as a single tool.
 *
 * Exposes exactly one tool, "gh", whose input is an array of CLI
 * arguments -- the same ones you'd type after `gh` on a command line.
 * Invoking it runs the real gh binary with those arguments and returns
 * its combined stdout/stderr.
 *
 * Resolution order for finding gh, mirroring docker-or-stub.js:
 *   1. native `gh` on PATH.
 *   2. on Windows only, `wsl gh` -- covers gh installed only inside
 *      WSL and not on the native Windows PATH.
 *   3. neither: falls back to reporting zero tools (same degrade
 *      pattern as docker-or-stub.js) instead of hard-failing.
 *
 * Auth: .mcp.json sets GH_TOKEN on this process's own env from
 * ${user_config.github_token}, so gh authenticates with the plugin's
 * configured token instead of needing a separate `gh auth login` on
 * the machine. For the native path that's inherited automatically via
 * process.env. For the WSL path it's handed across explicitly via
 * `env GH_TOKEN=...` inside the wsl invocation, rather than relying on
 * WSLENV being configured -- WSL does not share Windows environment
 * variables into the Linux environment by default.
 *
 * PROTOCOL: built on @modelcontextprotocol/sdk (declared in this
 * plugin's package.json, auto-installed by Claude Code's documented
 * Node-dependency mechanism) rather than hand-parsed JSON-RPC. The
 * "gh" tool is only registered with the SDK when gh was actually
 * resolved; when it wasn't, the server still starts and answers the
 * handshake, it just reports zero tools.
 *
 * Caveats:
 * - stdout/stderr are captured separately and concatenated at the end
 *   in that order, not interleaved as they'd appear in a live
 *   terminal -- fine for typical `gh` output, not a byte-for-byte
 *   terminal replay.
 * - Output isn't capped; a very large `gh` response is held fully in
 *   memory before being returned.
 * - Docker-style detection checks CLI presence only (`gh --version`),
 *   not whether it's actually authenticated.
 */

const { spawnSync, spawn } = require('child_process');

function commandExists(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'ignore' });
  return !result.error && result.status !== null;
}

/**
 * Resolves how to invoke gh on this machine. Returns a function
 * (args: string[]) => { command, args, env } ready for
 * child_process.spawn, or null if gh isn't reachable at all.
 */
function resolveGh() {
  if (commandExists('gh', ['--version'])) {
    return (args) => ({ command: 'gh', args, env: process.env });
  }
  if (process.platform === 'win32' && commandExists('wsl', ['gh', '--version'])) {
    return (args) => ({
      command: 'wsl',
      args: ['env', `GH_TOKEN=${process.env.GH_TOKEN || ''}`, 'gh', ...args],
      env: process.env,
    });
  }
  return null;
}

function runGhTool(build, callArguments) {
  return new Promise((resolve) => {
    const argList = Array.isArray(callArguments && callArguments.args) ? callArguments.args : [];
    const invocation = build(argList);
    const child = spawn(invocation.command, invocation.args, { env: invocation.env });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });

    child.on('error', (err) => {
      resolve({ isError: true, text: `Failed to launch gh: ${err.message}` });
    });
    child.on('close', (code) => {
      const text = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');
      resolve({ isError: code !== 0, text: text || `(gh exited with code ${code}, no output)` });
    });
  });
}

const GH_TOOL = {
  name: 'gh',
  description:
    'Runs the GitHub CLI (gh) with the given arguments and returns its output. ' +
    'Equivalent to running `gh <args...>` in a shell -- do not include the leading "gh".',
  inputSchema: {
    type: 'object',
    properties: {
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments to pass to gh, e.g. ["pr","list","--repo","owner/repo"].',
      },
    },
    required: ['args'],
  },
};

async function main() {
  let Server, StdioServerTransport, ListToolsRequestSchema, CallToolRequestSchema, ErrorCode, McpError;
  try {
    ({ Server } = require('@modelcontextprotocol/sdk/server/index.js'));
    ({ StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js'));
    ({
      ListToolsRequestSchema,
      CallToolRequestSchema,
      ErrorCode,
      McpError,
    } = require('@modelcontextprotocol/sdk/types.js'));
  } catch (err) {
    process.stderr.write(
      `gh-tool-or-stub.js: @modelcontextprotocol/sdk failed to load (${err.message}). ` +
      `This plugin's Node dependencies may not have installed correctly.\n`
    );
    process.exit(1);
  }

  const build = resolveGh();

  const server = new Server(
    { name: 'gh-tool', version: build ? '1.0.0' : '0.0.0-no-gh' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: build ? [GH_TOOL] : [],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!build || request.params.name !== 'gh') {
      throw new McpError(
        ErrorCode.MethodNotFound,
        build ? `Unknown tool: ${request.params.name}` : 'gh unavailable, no tools'
      );
    }
    const result = await runGhTool(build, request.params.arguments);
    return {
      content: [{ type: 'text', text: result.text }],
      isError: result.isError,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`gh-tool-or-stub.js: fatal error: ${err.message}\n`);
  process.exit(1);
});
