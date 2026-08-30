#!/usr/bin/env node
'use strict';

/**
 * Launches a stdio MCP server via `docker run <image>`, if a docker CLI
 * is reachable. If not, falls back to a stub MCP server reporting zero
 * tools/resources/prompts, so the plugin degrades gracefully instead of
 * hard-failing for users who don't have Docker.
 *
 * Usage: node docker-or-stub.js <image>
 *
 * Env vars forwarded into the container as literal `-e KEY=VALUE` args
 * (only if set on this process): API_MCP_MODE, HTTP_AUTHORIZATION,
 * OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS.
 * The OTEL_* ones are not wired up in .mcp.json by default (see the
 * plugin README) -- they're forwarded here only so someone who *does*
 * set them locally doesn't have to touch this script.
 *
 * STUB IMPLEMENTATION: the no-docker fallback uses @modelcontextprotocol/sdk
 * (declared in this plugin's package.json, auto-installed by Claude Code's
 * documented Node-dependency mechanism) instead of a hand-rolled JSON-RPC
 * reader. The SDK require() is deliberately deferred to inside runStub()
 * rather than done at module load time: if that dependency install ever
 * fails, this keeps the failure scoped to "no docker AND require fails" --
 * the actual docker path above never touches the SDK at all and is
 * unaffected either way.
 *
 * IMPORTANT CAVEAT: Node has no equivalent of POSIX execve() that
 * replaces the current process image in place. This script approximates
 * "hand off to the docker process" by spawning it with inherited stdio
 * and forwarding its exit code/signals -- functionally equivalent for
 * an MCP stdio server (same stdin/stdout, same eventual exit code), but
 * it stays a child process under a live Node parent, not a true exec().
 *
 * Docker detection checks only that a `docker` CLI answers `--version`,
 * not that the daemon is healthy -- a CLI that's present but can't reach
 * a daemon will fail inside runDocker() rather than falling back to the
 * stub. On Windows this also does not assume Docker Desktop's Windows
 * PATH integration; it mirrors what a WSL-only docker setup needs by
 * trying `wsl docker` as a fallback.
 */

const { spawnSync, spawn } = require('child_process');

const image = process.argv[2];
if (!image) {
  process.stderr.write('docker-or-stub.js: missing image argument\n');
  process.exit(1);
}

const FORWARD_ENV = [
  'API_MCP_MODE',
  'HTTP_AUTHORIZATION',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
];

function commandExists(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'ignore' });
  return !result.error && result.status !== null;
}

/**
 * Resolves how to invoke docker on this machine.
 * 1. Native `docker` on PATH (Linux, macOS, Docker Desktop with
 *    Windows PATH integration).
 * 2. On Windows only, `wsl docker` -- mirrors a Docker-only-inside-WSL
 *    setup, matching how this repo's own reference config invokes it.
 * Returns { cmd, prefixArgs } or null if docker isn't reachable.
 */
function resolveDocker() {
  if (commandExists('docker', ['--version'])) {
    return { cmd: 'docker', prefixArgs: [] };
  }
  if (process.platform === 'win32' && commandExists('wsl', ['docker', '--version'])) {
    return { cmd: 'wsl', prefixArgs: ['docker'] };
  }
  return null;
}

function runDocker(resolved) {
  const dockerArgs = ['run', '--rm', '--pull', 'always'];
  for (const key of FORWARD_ENV) {
    if (process.env[key] !== undefined) {
      // Literal KEY=VALUE, not a bare `-e KEY`: under `wsl docker ...`,
      // WSL does not inherit the Windows process's environment unless
      // WSLENV is configured, so relying on the container picking the
      // value up from its own env would silently break there. Handing
      // the value across explicitly sidesteps that entirely.
      dockerArgs.push('-e', `${key}=${process.env[key]}`);
    }
  }
  dockerArgs.push('-i', image);

  const child = spawn(resolved.cmd, [...resolved.prefixArgs, ...dockerArgs], {
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code === null ? 1 : code);
    }
  });
  child.on('error', (err) => {
    process.stderr.write(`docker-or-stub.js: failed to launch docker: ${err.message}\n`);
    process.exit(1);
  });

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
}

/**
 * Minimal stub MCP server for when Docker isn't reachable: answers the
 * initialize handshake, reports zero tools/resources/prompts. Built on
 * the official SDK rather than hand-parsed JSON-RPC -- see the file
 * header for why the require() is deferred to here.
 */
function runStub() {
  let Server, StdioServerTransport, ListToolsRequestSchema, ListResourcesRequestSchema, ListPromptsRequestSchema;
  try {
    ({ Server } = require('@modelcontextprotocol/sdk/server/index.js'));
    ({ StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js'));
    ({
      ListToolsRequestSchema,
      ListResourcesRequestSchema,
      ListPromptsRequestSchema,
    } = require('@modelcontextprotocol/sdk/types.js'));
  } catch (err) {
    process.stderr.write(
      `docker-or-stub.js: docker unavailable and @modelcontextprotocol/sdk failed to load ` +
      `(${err.message}). This plugin's Node dependencies may not have installed correctly.\n`
    );
    process.exit(1);
  }

  const server = new Server(
    { name: `${image}-stub`, version: '0.0.0-no-docker' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  // Declaring a capability above isn't enough on its own -- the SDK
  // answers "method not found" for any list method with no registered
  // handler, so each capability needs its own empty-list handler here.
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));

  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    process.stderr.write(`docker-or-stub.js: stub server failed to connect: ${err.message}\n`);
    process.exit(1);
  });
}

const resolved = resolveDocker();
if (resolved) {
  runDocker(resolved);
} else {
  runStub();
}
