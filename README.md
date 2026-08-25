# skills-github

A Claude plugin marketplace containing a single plugin, **github-tools**: a
family of 10 skills for GitHub operations and pull-request maintenance.

These skills were exported as-is from a Claude session's synced skill set
(`~/.claude/skills/synced/github-*`) on 2026-08-25.

## Install

Inside Claude Code (or any Claude surface that supports plugin marketplaces):

```
/plugin marketplace add plengauer/skills-github
/plugin install github-tools@skills-github
```

The first command registers this repo as a marketplace; the second installs
the `github-tools` plugin (this can also be done by clicking "Install" on the
plugin once the marketplace is browsable in the plugin UI, rather than typing
the second command).

To pick up future updates to this repo:

```
/plugin marketplace update skills-github
```

## What's included

All 10 skills live under `plugins/github-tools/skills/`:

| Skill | Purpose |
|---|---|
| `github-generic` | General-purpose GitHub skill defining the tool-priority ladder (GitHub MCP → REST API → GraphQL API → Chrome → computer control) and general operating rules used by the rest of the family. |
| `github-pr-automation-detection` | Classifies whether a PR was opened by self-updating automation (Renovate, version-bump, etc.), a coding agent (Copilot/Claude), or a human. A classifier consumed by several sibling skills. |
| `github-pr-volatile-failure-detection` | Classifies a failed CI job's log as volatile (worth a rerun), real (leave it failing), or unclear. A classifier consumed by the checks skills. |
| `github-pr-rerun-volatile-checks` | Finds failed checks on a PR's head commit and reruns only the ones classified volatile. |
| `github-pr-fix-checks` | Analyzes non-volatile check failures and asks Copilot to fix them via a plain PR comment. |
| `github-pr-rebase-conflicted` | Asks a coding agent to rebase a PR with a real merge conflict, unless the PR is self-updating automation. |
| `github-pr-handle-change-requests` | Triages every review and review thread on a PR — resolves noise, applies clear-cut suggestions, asks Copilot to fix the rest, and surfaces genuinely ambiguous items for a human. |
| `github-pr-iterate` | Orchestrates the four skills above into one holistic pass per PR, posting at most one combined Copilot comment. |
| `github-pr-approve-automation` | Approves a PR only if it's self-updating automation without an existing approval, so auto-merge can clear its review gate. |
| `github-pr-reassign-broken-copilot` | Detects a coding-agent PR whose backing session silently died, resets the source issue, and reassigns it to Copilot. |

Each skill is scoped to exactly one PR per invocation and is written to work
standalone; `github-pr-iterate` is the only one that composes the others.

## Repository structure

This repo follows the [Claude Code plugin marketplace
format](https://code.claude.com/docs/en/plugin-marketplaces):

```
.claude-plugin/marketplace.json          # marketplace catalog (this repo)
plugins/github-tools/.claude-plugin/plugin.json   # plugin manifest
plugins/github-tools/skills/<name>/SKILL.md       # one folder per skill
```
