---
name: github-pr-reassign-broken-copilot
description: >
  Check whether a single GitHub pull request looks like a coding agent
  (Copilot, Claude, Codex, or similar) that silently failed — a draft,
  WIP-titled PR assigned to a coding agent, with at least one commit,
  whose backing session has fully terminated — and if so, reset the
  source issue and reassign it to Copilot so a fresh attempt starts, then
  close the old PR (referencing the new one) and delete its branch.
  Checks run cheapest-first and stop at the first mismatch. Scoped to
  exactly one PR per invocation. Use for "did copilot/claude/codex crash
  on this PR", "reset the issue this coding agent silently failed on",
  or as one step of broader per-PR maintenance. Only acts once the PR's
  agent session has fully terminated. Reassignment always targets
  Copilot regardless of which agent originally failed.
compatibility: >
  Needs to read a PR's title, draft status, assignees, and commit list
  (not the full diff); read an issue's assignees and body; clear and set
  issue assignees; check the status of the GitHub Actions run(s)/agent
  job(s) tied to a PR; and, once reassignment has produced a fresh
  attempt, close the old PR and delete its head branch. GitHub's
  REST/GraphQL APIs and most GitHub MCP connectors cover all of this.
  Coding-agent involvement is confirmed directly via the assignee field.
---

# GitHub PR Reassign Broken Copilot

Checks whether one pull request looks like a coding-agent session that
quietly gave up: a draft, WIP-titled PR, assigned to a recognized coding
agent (e.g. `Copilot`, `Claude`, `Codex`, or a similar automated
coding-agent bot account), whose backing session has stopped running.
Once that combination holds, there's nothing on the PR itself worth
retrying — so this skill resets the *issue* that triggered the attempt
instead, so a clean new session can start. Once that new attempt has
visibly started, the old dead-end PR and its branch are cleaned up so
they stop cluttering the repo.

Regardless of which agent's session actually broke, the fresh
reassignment always targets **Copilot** — this skill's job is to get a
working attempt going again, not to retry whichever agent failed.

This skill describes what to check and when to act, not which specific
tool call does it. Use whatever's available in the current session — a
GitHub MCP, the REST or GraphQL API directly, a CLI, or browser control.

Staying tool-agnostic doesn't mean ignoring what's cheap for whatever
tool you're using, though. If a single call can return several of the
early fields at once — title, draft status, and assignees are often all
part of the same basic PR payload — fetch them together rather than
issuing separate round-trips for what's really one lookup. The phase
numbers below describe an order to *reason* in, not a mandate for one
tool call per phase. The thing to still watch for: don't let "fetch it
all in one go" extend to the expensive fields — pulling commits or
Actions run status alongside title/draft/assignee just because a tool
happens to support it in a single call defeats the point of gating them
behind the cheaper checks passing first.

## Scope: one PR

This skill operates on exactly one PR per invocation — given as a URL or
`owner/repo#123`. It doesn't expand a repo or a list into multiple PRs;
a caller that wants this applied across several PRs invokes it once per
PR.

## Phased checks — stop at the first mismatch

Check these five in order for this one PR. The moment one doesn't hold,
stop — there's no reason to spend a more expensive call ruling out
something that's already ruled out.

### Phase 1: Title

Does the PR's title carry the marker coding agents use for in-progress
work (typically "WIP", case-insensitive substring — adjust if this
repo's agent uses a different convention)? Title comes free with any PR
lookup, so this is the cheapest possible check and goes first. No match,
no further checks — stop and report the PR isn't a candidate.

### Phase 2: Draft status

Is the PR still marked as a draft? Coding agents open their PRs as
drafts and only convert one to "ready for review" once it's actually
finished — a session that silently failed never gets that far, so a
WIP-titled PR that's already out of draft either finished successfully
or a human has since taken it over. Either way, not a match. Draft
status is a boolean on the same basic PR object as the title, so this is
still a free check. No match, stop here.

### Phase 3: Assignee

Is one of the recognized coding-agent accounts — `Copilot`, `Claude`,
`Codex`, or a similar automated coding-agent bot account — among the
PR's assignees? Assignees are typically part of the same basic PR
payload as the title, so this is still a cheap check — and it's what
keeps this skill from ever touching a human's own WIP-titled draft PR,
since assigning a coding agent to your own PR isn't something that
happens by accident. Note which agent was actually assigned; it's used
later for the reset step and doesn't change how the PR is handled —
every agent is treated the same from here on, and reassignment always
targets Copilot regardless of which one this was. No match, stop here
and leave the PR alone.

### Phase 4: Commits

Only checked once phases 1–3 all hold, since it costs a call the earlier
ones don't. Confirm the PR has at least one commit — deliberately not
the diff or file changes, which is a more expensive fetch. In practice
this is close to a formality: coding agents create a placeholder commit
(commonly titled something like "Initial plan") the instant a session
starts, so a PR that's gotten this far will almost always have at least
one commit whether or not real work ever landed — see "Things this skill
does not do" below for what that trade-off means. Treat literally zero
commits as a mismatch; genuinely rare, but stop rather than guess.

### Phase 5: Session status

Only reached once phases 1–4 all hold — this is the most expensive
signal, so it's checked last and only once the cheaper signals already
look like a real match. A "session" here is the GitHub Actions run that
does the agent's actual work (often labeled something like "Copilot
coding agent", "Claude Code", or "Codex cloud agent" in the Actions tab,
depending on which agent was assigned) — not the PR itself, and there
can be more than one, since GitHub sometimes auto-retries a session that
looks stuck with a follow-up run, without that producing a second PR.
Enumerate every run tied to this PR's head branch or commit — a
dedicated "agent job status" tool, if one is available, is the most
reliable way to find all of them in a single call. Confirm every one of
them has reached an end state (completed, cancelled, failed — whatever
the exact vocabulary is) with none still `queued` or `in_progress`. If
even one run is still active, the honest answer is "too early to tell" —
stop for now without acting; a later run of this skill will pick this PR
back up once the session actually finishes.

Only a PR that clears all five phases is a confirmed broken coding-agent
PR. Everything below only happens then.

## Confirmed broken: reset and reassign

### Find the issue behind it

Coding-agent PRs consistently reference the issue that triggered them
using GitHub's own closing-keyword convention in the PR body —
`Fixes #NNNN`, `Closes owner/repo#NNNN`, `Resolves #NNNN`,
case-insensitive. If whatever tool you're using exposes the structured
PR-to-issue link directly (GitHub's own "Development" sidebar linkage),
prefer that over parsing body text — it's the authoritative source and
doesn't depend on exact phrasing. If the body has no recognizable
closing keyword, or references more than one issue and it's genuinely
unclear which one spawned this attempt, don't guess: stop and report
that the source issue couldn't be identified.

### Reset and reassign

On the **issue**, not the PR: clear every current assignee. This is
deliberate, not partial — the coding agent itself is typically still
shown assigned even though its session already ended, and a human is
sometimes co-assigned alongside it too (common when someone assigns
themselves for visibility). Clear both, so the fresh assignment below
starts from a clean slate rather than layering onto stale state. Note
exactly who was removed — this shouldn't be a silent surprise, especially
if a human was among them.

Then assign **Copilot** to retry — regardless of which agent's session
just broke (Copilot, Claude, Codex, or otherwise), the fresh attempt
always goes to Copilot, unless the user asked this particular run to use
a different one. Assigning the agent is usually what actually starts the
new session, often within the same call, producing a fresh PR right
away — many assignment tools return that new PR's number and URL
directly in their response.

### Close the old PR and clean up its branch

Only once the reassignment above has visibly produced a fresh attempt —
a new PR number/URL back from the assignment call, or (if the tool
doesn't return one) a newly created PR found referencing the same issue
on a follow-up check. If reassignment didn't clearly produce a new
attempt, leave the old PR alone for this run rather than closing it
against an attempt that may not actually be happening — a later run can
pick it up once a new PR shows up.

Once a new attempt is confirmed:

- Close the old broken PR. Leave a short closing comment pointing at the
  new one (e.g. "Superseded by #NNN — reassigned after the original
  {agent} session failed to complete.", naming whichever agent Phase 3
  found) so anyone landing on the old PR later isn't left guessing where
  the work went.
- Delete the old PR's head branch. This is the agent-created branch
  (typically named after the agent, e.g. `copilot/...`, `claude/...`, or
  `codex/...`) that the closed PR was built from — safe to remove since
  nothing else should be building on a branch backing an abandoned
  session. Skip the delete (but still close the PR) if the branch can't
  be identified as exclusive to this PR, or if deleting it errors — note
  that rather than treating it as fatal.

This skill's job ends there — it doesn't wait for or judge the new
attempt itself. If that one breaks the same way, the next run of this
skill will find it, reassign again, and close it out the same way.

## Report

No tables — a short, plain summary of this one PR:

- The PR's title and URL.
- Which phase it stopped at, if it didn't clear all five, and why (not
  WIP-titled, not a draft, no recognized agent assignee, no commits, or
  a session still running — in which case say a later pass will pick it
  back up).
- If confirmed broken: exactly who was unassigned from the source issue,
  confirmation Copilot was newly assigned, whether the old PR was
  closed, and whether its branch was deleted (or why not, if skipped).
- If it was confirmed broken but couldn't be completed: why not — no
  source issue found, the issue was ambiguous, the unassign/reassign
  call itself errored, or reassignment succeeded but no new PR could be
  confirmed (old PR left open in this case).

## Things this skill does not do

Doesn't act on a PR whose session is still running, no matter how the
earlier phases came out — "still running" and "confirmed broken" are
different findings, and only the second gets acted on.

Doesn't act on a PR that's already been marked ready for review, even if
the title still says WIP and a coding agent is still assigned — Phase 2
treats leaving draft status as evidence the attempt already concluded
one way or another, not as still up in the air.

Doesn't touch a PR that isn't assigned to a recognized coding agent,
even one titled WIP — the assignee check exists specifically to keep
this skill from ever touching someone's own in-progress work.

Doesn't check whether real work actually landed beyond the placeholder
commit — Phase 4 only confirms a commit exists, not what it contains. A
PR that's WIP-titled, still draft, and assigned to a coding agent but
whose session ended after pushing genuine partial progress is still
treated as broken and reassigned (and its PR closed once the new
attempt starts).

Doesn't check whether this issue was already reassigned recently, or
whether a newer PR already supersedes this one — a PR that clears all
five phases gets reassigned regardless, even if that means a second
concurrent attempt on the same issue.

Doesn't close or delete anything until a new attempt is confirmed — if
reassignment fails outright, or succeeds but no new PR can be found, the
old broken PR is left exactly as-is rather than closed with nothing to
point to.

Doesn't retry with whichever agent originally failed — reassignment
always targets Copilot, even when the broken session belonged to Claude,
Codex, or another agent.

Doesn't wait for or judge the new attempt it triggers.
