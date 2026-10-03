---
name: github-agentic-workflow-run
description: >
  Manually run a GitHub Agentic Workflow (a gh-aw `.github/workflows/<name>.md`
  file) in this Claude session instead of on GitHub Actions — read its
  markdown, respect every frontmatter field, bind it to one concrete
  triggering event (an issue, a comment, a PR, a discussion, a dispatch),
  and carry out the prompt exactly as the workflow would, with writes limited
  to what its `safe-outputs` allow. Takes a repository, a workflow name (or
  path to its .md file), and the trigger. Use whenever the user asks to "run
  the autotriage workflow on this issue", "manually run agentic workflow X",
  "execute <name>.md against this comment", "simulate this gh-aw workflow",
  or similar.
compatibility: >
  Needs read access to the target repository's contents (to load the
  workflow and its imports) and to whatever the trigger points at, plus the
  write access each declared safe output needs. Follows `github-generic`'s
  tool-priority ladder for every GitHub call.
---

# GitHub Agentic Workflow Run

Executes one [GitHub Agentic Workflow](https://github.github.com/gh-aw/)
by hand: the markdown file is treated as if GitHub Actions had just started
it for a given event, and this session plays the role of the agent job.

Use whatever GitHub tooling the session has, following `github-generic`'s
tier ladder and its general operating rules (disclosure marker, file-mode
preservation, etc.).

## Hard rules

1. **No user questions.** Never stop to ask the user anything — not for
   clarification, not for confirmation, not to choose between options. The
   workflow ran because an event fired; behave like the unattended Actions
   job would. When something is ambiguous, take the conservative path
   (usually: do less, write nothing) and explain the choice in the final
   report. If the run cannot proceed, stop and report why.
2. **Every write is a safe output.** The only mutating operations allowed
   are those that implement a safe-output type declared in the workflow's
   `safe-outputs:` frontmatter, within that type's configured limits. Any
   other write — even a harmless-looking reaction, label, or comment — is
   forbidden. Reads are unrestricted except where the frontmatter narrows
   them (see `permissions`/`tools` below).
3. **Respect all of the frontmatter.** Every key is either honored,
   emulated, or — when it only makes sense on an Actions runner — explicitly
   listed in the report as "not applicable to a manual run". Nothing is
   silently ignored.
4. **The workflow's own prompt governs the task**, not the user's request.
   The user only chooses *which* workflow and *which* event; they don't get
   to widen what the workflow is allowed to do.

## Inputs

1. **Repository** — `owner/repo` (or a URL to it). This is the repository
   the workflow lives in *and* runs against, as on Actions.
2. **Workflow** — a name, a filename, or a path. Resolve in this order and
   stop at the first hit:
   - an exact path (e.g. `.github/workflows/autotriage.md`);
   - `.github/workflows/<name>.md`, then `.github/workflows/<name>`
     (if `<name>` already ends in `.md`);
   - a `.md` under `.github/workflows/` whose frontmatter `name:` matches
     `<name>` case-insensitively.
   Never use the compiled `*.lock.yml` as the source of truth — it's
   generated from the `.md`. If nothing matches, or several files match
   equally well, stop and report the candidates.
3. **Trigger** — what the event is about. Its shape depends on the event:

   | Trigger argument | Event it emulates |
   |---|---|
   | Issue URL / `#123` | `issues` (default type `opened`) |
   | Issue- or PR-comment URL (`…#issuecomment-<id>`) | `issue_comment` (type `created`); also `slash_command`/`command` |
   | PR URL | `pull_request` (default type `opened`) |
   | PR review-comment URL (`…#discussion_r<id>`) | `pull_request_review_comment` |
   | PR review URL (`…#pullrequestreview-<id>`) | `pull_request_review` |
   | Discussion URL | `discussion` |
   | Discussion-comment URL (`…#discussioncomment-<id>`) | `discussion_comment` |
   | Release / tag URL | `release` |
   | Commit SHA or branch | `push` |
   | `workflow_dispatch` plus `key=value` inputs | `workflow_dispatch` |
   | `schedule` | `schedule` |

   The caller may name the event type explicitly (e.g. "issues/labeled",
   "pull_request/synchronize"); otherwise use the default type in the
   table. Fetch the referenced object (and, for a comment, the issue/PR it
   belongs to) — that is the event payload.

## Step 1: Load the workflow

1. Read the resolved `.md` from the repository's default branch (or the
   ref the caller named).
2. Split YAML frontmatter from the markdown body. Invalid YAML → stop.
3. Resolve **imports** recursively — the `imports:` key and any
   `{{#import …}}` / `@include` directives in the body — relative to the
   workflow file (or `owner/repo/path@ref` for remote ones). Merge them the
   way gh-aw does: imported `tools`, `mcp-servers`, `safe-outputs`,
   `network`, `permissions`, `steps` and `runtimes` are merged into the main
   frontmatter; imported markdown bodies are inlined at the directive (or
   prepended, for `imports:`). An unresolvable required import → stop;
   an optional one (`{{#import? …}}`) → skip and note it.

## Step 2: Activation gates — decide whether the workflow runs at all

Evaluate these in order. If any one says "don't run", stop, write
nothing, and report which gate stopped it.

- **Event match.** The emulated event (and type) must appear under `on:`.
  Honor `types:`, `branches`/`branches-ignore`, `paths`/`paths-ignore`,
  `tags`, and `names` filters. `slash_command:`/`command:` matches only if
  the comment body begins with `/<command-name>` (and, when `events:` is
  given, only for those events). `workflow_dispatch` must declare any
  `required` input the caller didn't supply → stop if missing; fill defaults
  for the rest. `schedule` matches when `on:` has any `schedule` entry
  (fuzzy schedules like `daily` included).
- **`on.stop-after`** — if the deadline (absolute or relative to the
  workflow file's last commit) has passed, don't run.
- **`on.roles`** (default `[admin, maintainer, write]`; `all` disables the
  check) — check the *event actor's* permission on the repository: the
  comment/issue/PR author for those events, the authenticated user for
  `workflow_dispatch`/`schedule`/manual cases. **`on.bots`** allows the
  listed bot accounts through regardless. **`on.skip-roles`**,
  **`on.skip-bots`**, **`on.skip-author-associations`** → skip when matched.
- **`on.forks`** — for `pull_request`, if the PR head is a fork that isn't
  allowed, don't run.
- **`on.skip-if-match` / `on.skip-if-no-match`** — run the given GitHub
  search query (with its `max` threshold, default 1) and skip accordingly.
- **`user-rate-limit`** — count this workflow's recent runs for the same
  actor within `window` minutes (from Actions run history of the compiled
  workflow); if `max-runs-per-window` is already reached, don't run.
- **`if:`** — evaluate the Actions expression against the emulated
  `github` context. If it references something that can't be evaluated
  outside Actions (job outputs, `secrets`, step results), treat the gate as
  **not passed** and report it — conservative path.
- **`on.manual-approval`** / **`environment:`** protection rules — a
  manual run can't satisfy an environment approval; don't run, and say so.

## Step 3: Build the agent context

1. **Render the body.** Substitute `${{ … }}` expressions from the emulated
   context: `github.repository`, `github.repository_owner`, `github.actor`,
   `github.event_name`, `github.run_id` (use `manual`), `github.event.*`
   fields of the fetched payload (e.g. `github.event.issue.number`,
   `github.event.comment.id`, `github.event.pull_request.head.ref`),
   `github.event.inputs.*` / `inputs.*` for dispatch, `vars.*` (read
   repository variables if available, else leave blank and note it),
   `github.aw.import-inputs.*`. `${{ needs.activation.outputs.text }}` is
   the sanitized triggering text: `title + "\n\n" + body` for an issue/PR,
   the comment body for a comment (with the `/command` stripped for
   slash commands). **Never** resolve `${{ secrets.* }}` — leave it blank.
   Evaluate `{{#if …}}` blocks with the same context.
2. **Scope reads to `permissions` + `tools`.**
   - `permissions:` names the read scopes the agent has (`contents`,
     `issues`, `pull-requests`, `discussions`, `actions`, `checks`,
     `security-events`, …; `read-all` grants all). Don't read categories
     the workflow wasn't granted.
   - `tools.github.toolsets` / `tools.github.allowed` further restrict which
     GitHub read operations the agent may use. Stay inside them.
   - `tools.web-fetch` / `tools.web-search` — use web tools only if declared.
     When `network:` is restricted, only fetch domains it allows.
   - `tools.bash` / `tools.edit` — shell commands or file edits only if
     declared; with an allowlist (e.g. `bash: ["git status", "npm test"]`),
     only those commands. Work happens in a scratch checkout of the repo,
     never on the user's own files. Local edits are not writes to GitHub —
     they only reach GitHub through a safe output such as
     `create-pull-request` or `push-to-pull-request-branch`.
   - `tools.playwright`, `tools.cache-memory`, `tools.repo-memory`,
     `mcp-servers:`, `mcp-scripts:`, `skills:`, `plugins:` — use an
     equivalent available in this session if there is one; otherwise treat
     the tool as missing (see `missing-tool` below).
3. **`steps:` / `pre-steps:` / `pre-agent-steps:` / `on.steps`.**
   Deterministic Actions steps can't execute here. If a step only gathers
   data read-only (checkout, `gh api` GETs, reading files), emulate it with
   read tools. If one mutates anything, or its output is something the
   prompt depends on and can't be reproduced, stop and report it rather
   than guessing.

## Step 4: Execute the prompt

Act as the agent: follow the rendered markdown body as its instructions,
with the bound event as context, using only the tools allowed in Step 3.
Respect `max-turns` as an upper bound on reasoning/tool rounds and
`timeout-minutes` as a soft budget.

Collect every intended write as a **safe-output item** (type + fields)
first, rather than writing as you go. Then apply them in Step 5.

## Step 5: Apply safe outputs

For each collected item, look up its type under `safe-outputs:`. Types the
workflow didn't declare are **dropped** and listed in the report. If the
workflow has no `safe-outputs:` section at all, gh-aw's documented default
is a conservative `create-issue`; allow only that.

Per declared type, enforce its configuration before writing:

- **`max`** — apply at most that many items of the type (gh-aw defaults:
  most types 1; `add-labels`/`remove-labels`/`add-reviewer` 3;
  `hide-comment` 5; `create-pull-request-review-comment`, `close-pull-request`,
  `update-project`, `upload-asset` 10). Excess items are dropped and
  reported.
- **`target`** — `triggering` (default) means only the issue/PR/discussion
  that triggered the run; a number pins one; `*` allows any (the item must
  then name its target). Off-target items are dropped.
- **`target-repo` / `allowed-repos`** — cross-repo writes only to listed
  repos; otherwise only the workflow's own repo.
- **`allowed` / `blocked`** (labels, issue types, milestones, review
  events, …) — drop values outside the allowlist or matching the blocklist.
- **`required-labels` / `required-title-prefix`** — the target must carry
  them, else drop.
- **`title-prefix`, `labels`, `assignees`, `reviewers`, `draft`,
  `expires`, `close-older-*`, `hide-older-comments`,
  `deduplicate-by-title`, `group`** — apply exactly as configured.
- **`protected-files`** — a `create-pull-request` /
  `push-to-pull-request-branch` that touches protected paths is dropped.
- **`footer`** — gh-aw adds an attribution footer unless `footer: false`.
  Independently, every posted body ends with the `github-generic`
  disclosure marker `(🤖 generated by Claude)`; never put it in titles.
- **`staged: true`** (globally or per type) — preview only: do not write,
  show what would have been written.
- **`github-token` / `github-app`** — can't be honored here; writes use
  this session's GitHub identity. Note in the report that actor attribution
  differs from a real run (e.g. `assign-to-agent` may need a token the
  session lacks — if it fails, report it, don't work around it).
- **`noop`, `missing-tool`, `missing-data`** — always available; include
  them in the report only, they don't write to GitHub.

Mechanics needed to fulfil a declared output (e.g. creating a branch and
pushing commits for `create-pull-request`) are part of that output and
allowed; nothing beyond them is.

## Not applicable to a manual run

List these in the report if present, without acting on them: `engine`,
`runs-on`/`runs-on-slim`, `container`, `services`, `runtimes`, `cache`,
`concurrency`, `env`/`excluded-env`, `secrets`, `observability`,
`threat-detection*`, `max-ai-credits`/`max-daily-ai-credits`,
`features`, `strict`, `run-name`, `tracker-id`, `source`/`redirect`,
`private`, `check-for-updates`, `post-steps`, `jobs`, and the activation
job's own side effects — **`on.reaction`** and **`on.status-comment`**.
Those last two are writes that are not safe outputs, so rule 2 forbids
them; mention them as skipped.

## Report

A short plain summary (no tables):

- Workflow file (link) and the trigger it was bound to (link).
- Whether it ran; if a gate stopped it, which one and why.
- What the agent concluded, in a sentence or two.
- Each safe output applied, with links; each dropped item with the reason
  (undeclared type, over `max`, off-target, not in `allowed`, staged).
- `noop` / `missing-tool` / `missing-data` messages, if any.
- Frontmatter keys that were not applicable or could only be approximated
  (and any conservative choice made in place of a question).

## Things this skill does not do

Doesn't compile, edit, or recompile the workflow (`gh aw compile`), doesn't
dispatch the real Actions run, and doesn't fan out — exactly one workflow
against exactly one trigger per invocation.
