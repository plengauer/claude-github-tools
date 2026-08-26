---
name: github-pr-rebase-conflicted
description: >
  Ask a coding agent (e.g. @copilot) to rebase a single GitHub pull
  request — one with a real merge conflict against its base branch —
  unless the PR is itself self-updating automation that rebases itself
  (Renovate, version-bump, etc.). Fire-and-forget: drafts a comment
  asking for the fix rather than resolving conflicts directly. Scoped to
  exactly one PR per invocation. Use whenever the user asks to "fix merge
  conflicts on this PR", "ask copilot to rebase this PR", "this PR has
  conflicts", or as one step of broader per-PR maintenance.
compatibility: >
  Needs a way to read a PR's mergeability state (dirty/conflicted vs.
  blocked vs. still-computing), its recent comments, and to post a
  comment on it — GitHub's REST API covers all three. Also needs the
  `github-pr-automation-detection` skill to classify the PR when it's
  conflicted.
---

# GitHub PR Rebase Conflicted

Nudges a coding agent to fix a conflict on a PR that won't fix itself.
Never resolves the conflict directly and never force-pushes — the only
mutation this skill performs is posting one comment.

This skill describes *what* to check and *when to act*, not which
specific tool call does it. Use whatever's available in the current
session — a broad GitHub connector, the REST API directly, a CLI, or
browser control.

## Scope: one PR

This skill operates on exactly one PR per invocation — given as a URL or
`owner/repo#123`. It doesn't expand a repo or a list into multiple PRs;
a caller that wants this applied across several PRs invokes it once per
PR.

## Gate: at least one commit

Before anything else, confirm the PR has at least one commit. A PR with
literally zero commits has nothing to have a mergeability state worth
acting on — stop immediately and report that plainly rather than
proceeding. Everything below assumes this gate has passed.

## Step 0: Gather state

Read the PR's mergeability state. GitHub distinguishes "dirty"/
conflicted from "blocked" (something else is holding it up, not a
conflict) from still-computing. A not-yet-known result means GitHub is
still computing it in the background — this happens right after a push.
Re-check once after a few seconds rather than treating "not yet known"
as "not conflicted"; a stale read here silently skips a PR that's
actually conflicted.

If the PR isn't conflicted (clean, or blocked for some other reason),
there's nothing for this skill to do — report that and stop.

## Task: classify, then ask for the rebase

For a PR confirmed conflicted, consult the `github-pr-automation-detection`
skill before treating it as something to raise:

- **`automation`** (self-updating: Renovate, version-bump, OTel-deploy,
  workflow-recompile, etc.) → skip. It already keeps itself current —
  a rebase ask would be redundant with what it does on its own schedule.
- **`coding-agent`** (Copilot, Claude, or similar) → does **not** count
  as automation for this purpose, even though the classifier reports it
  as a separate bucket from `human`. Nothing regenerates a coding
  agent's own PR on a schedule the way Renovate does, so asking the
  agent to fix its own PR's conflicts is exactly the right move.
- **`human`** (also covers anything the classifier couldn't confidently
  place in the other two buckets) → this is a real conflict to raise.

For a PR that reaches this point, first check whether a request is
already in flight, so repeated runs of this skill don't spam the PR —
look for signs of an active coding-agent session on the PR, or an
existing rebase-related mention in recent comments newer than the PR's
last push. If found, report that and stop — don't draft a duplicate ask.

Otherwise, draft an instruction along these lines:

> @copilot this PR has a merge conflict with the base branch. Please
> rebase (or merge the base branch in) and resolve the conflicts.

Always mention `@copilot` specifically, regardless of who or what opened
the PR — Copilot, Codex, Claude, or a human. Do not address the request
to Codex, Claude, or any other agent even if that agent authored the PR
or is assigned to it; Copilot is the fixed target for the rebase ask
itself. This is a deliberate override of the general "adjust to whatever
agent is set up" instinct — confirmed by the user, not a per-repo
judgment call.

Don't attempt to resolve the conflict directly and don't force-push —
this skill never touches the PR's branches or content, only comments on
it.

Post the drafted instruction as a single comment on the PR. This is the
only mutation this skill performs.

This task is fire-and-forget: the agent works asynchronously, so the
rest of *this* run still sees the current, still-conflicted head. A
later run of this skill picks up the fix once it's pushed.

## Report

No tables — a short, plain summary of this one PR:

- The PR's title and URL.
- If the gate failed: say so and stop there.
- Whether the PR was conflicted at all.
- If conflicted: whether it was skipped as automation, skipped because a
  request was already in flight, or a rebase ask was drafted/posted.
- If posted directly, a link to the comment.

## Things this skill does not do

Doesn't touch checks, volatile-failure reruns, review threads or formal
reviews, auto-merge, or draft state — see `github-pr-rerun-volatile-
checks`, `github-pr-fix-checks`, and `github-pr-handle-change-requests`
for those. Doesn't force-push, close, or reopen anything. Doesn't
resolve the conflict itself. Doesn't repost or edit an existing
rebase-ask comment.
