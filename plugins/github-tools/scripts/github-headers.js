#!/usr/bin/env node
'use strict';

/**
 * headersHelper for the "github" HTTP MCP server (GitHub Copilot MCP).
 * Prints a JSON object of header key -> value pairs to stdout, which
 * Claude Code merges into the request headers for this server.
 *
 * KNOWN ISSUES (as of when this was written -- test before relying on
 * this, don't assume either is fixed):
 * - anthropics/claude-code#41690: headersHelper reported as silently
 *   never executed at all for plugin-provided HTTP MCP servers.
 * - anthropics/claude-code#47789: ${CLAUDE_PLUGIN_ROOT} reported as not
 *   expanding inside headersHelper command strings specifically, which
 *   would make this script unreachable via the path used in .mcp.json.
 * If neither bug is hit, this runs fresh on every connect/reconnect --
 * no caching, `gh auth token` is cheap enough to call each time.
 *
 * Token resolution order:
 *  1. CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN env var, if userConfig.github_token
 *     was filled in. (Unconfirmed whether headersHelper subprocesses
 *     actually receive plugin option env vars -- documented for "hook
 *     processes and MCP/LSP subprocesses", headersHelper isn't named
 *     explicitly anywhere I found.)
 *  2. `gh auth token`, if a `gh` CLI is on PATH and logged in.
 *  3. Neither: emit {} (no Authorization header; the connection will
 *     then fail auth -- this script doesn't treat that as its own
 *     error, it just reports what it found).
 */

const { spawnSync } = require('child_process');

function commandExists(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'ignore' });
  return !result.error && result.status !== null;
}

function resolveToken() {
  const configured = (process.env.CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN || '').trim();
  if (configured) return configured;

  if (!commandExists('gh', ['--version'])) return null;
  const result = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || '').trim() || null;
}

const token = resolveToken();
process.stdout.write(JSON.stringify(token ? { Authorization: `Bearer ${token}` } : {}));
