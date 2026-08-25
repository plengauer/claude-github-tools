---
name: github-pr-iterate
description: >
  Drive a single GitHub pull request toward mergeable in one pass by
  performing everything `github-pr-rerun-volatile-checks`, `github-pr-
  fix-checks`, `github-pr-rebase-conflicted`, and `github-pr-handle-
  change-requests` would do individually, but as one holistic pass that
  posts at most one combined Copilot comment instead of letting each
  concern post its own. Scoped to exactly one PR per invocation. Use
  whenever the user asks to "iterate on this PR", "push this PR
  forward", "do a full pass on this PR", "check on this PR" as a
  catch-all, or names several of the sibling concerns (checks, conflicts,
  reviews) at once for a single PR.
compatibility: >
  Needs everything the four sibling skills need. Also needs
  `github-pr-volatile-failure-detection` and `github-pr-automation-
  detection`, since `github-pr-fix-checks` and `github-pr-rebase-
  conflicted` each depend on one of those.
---

# GitHub PR Iterate

The orchestrator for the `github-pr-*` check/conflict/review family.
This is the *only* skill in the family that knows about orchestration —
`github-pr-rerun-volatile-checks`, `github-pr-fix-checks`, `github-pr-
rebase-conflicted`, and `github-pr-handle-change-requests` are each
written to stand alone, with no awareness of being composed. All the
work of running them together and keeping Copilot from getting paged
four separate times lives here instead.

This skill describes *what* to run and *when*, not which specific tool
call any of the underlying work does — that's each sibling skill's own
concern.

## Scope: one PR

This skill operates on exactly one PR per invocation — given as a URL or
`owner/repo#123`. It doesn't expand a repo or a list into multiple PRs.
A caller that wants a batch of PRs iterated invokes this skill once per
PR — if the current session supports spawning subagents or subtasks, one
per PR in parallel is a reasonable way to do that, since each PR's pass
is entirely independent of every other PR's.

## Gate: at least one commit

Before anything else, confirm the PR has at least one commit. A PR with
literally zero commits has nothing yet for any of the four sibling
skills to check — stop immediately and report that plainly rather than
proceeding. This is the same gate each sibling skill applies on its own,
checked once here so the pass doesn't even start four separate
sub-checks for the same thing.

## Step 1: do the tasks in the four skills — but hold back their comments

Follow `github-pr-rerun-volatile-checks`, `github-pr-fix-checks`,
`github-pr-rebase-conflicted`, and `github-pr-handle-change-requests`
each on their own merits, in this order:

1. **`github-pr-rerun-volatile-checks`** — first, so that any flaky
   failure gets a rerun queued before the next skills read state that
   would otherwise still show it as a hard failure. Nothing to hold back
   here — this skill never posts a Copilot comment in the first place,
   only triggers reruns.
2. **`github-pr-fix-checks`** — second, now that whatever was volatile
   is back in progress rather than failed; whatever's still showing as a
   genuine failure at this point is genuine. Do its gathering and
   analysis exactly as written, and land on the same drafted instruction
   it would draft — but don't post it. Hold it.
3. **`github-pr-rebase-conflicted`** — third; independent of the checks
   work, but grouped right after it since both are about "is this PR
   fundamentally blocked from merging." Do its gathering, automation
   classification, and in-flight check exactly as written, and land on
   the same drafted instruction it would draft (if any) — hold it too,
   don't post.
4. **`github-pr-handle-change-requests`** — fourth; independent of the
   other three, but running it last keeps the pass's eventual single
   comment from arriving before the checks/conflict situation is known.
   Do everything it describes as its own direct mutations — resolving
   Bucket 1 threads, applying Bucket 2 suggestions — exactly as written,
   those aren't held back. Only its Bucket 3 drafted instruction (the
   "ask Copilot to fix" items) gets held rather than posted.

In short: every mutation that *isn't* "post a comment addressed to
Copilot" happens exactly when each skill says it should, run inline as
part of this same pass — reruns get triggered, threads get resolved,
suggestions get applied, the automation check for the conflict happens.
The one thing that's different from running each skill standalone is
that none of them actually posts its own Copilot-facing comment; each
one's drafted instruction (or "nothing to draft" for that skill) is
handed to Step 2 instead.

## Step 2: make one holistic plan, then post it once

Don't just concatenate the three (potential) drafted instructions from
`github-pr-fix-checks`, `github-pr-rebase-conflicted`, and `github-pr-
handle-change-requests` under three headers and call it done. Read all
of what each one turned up — the specific check failures, the merge
conflict (if any), the review-feedback items — and write **one coherent,
holistic plan for the entire PR**: everything Copilot needs to do here,
in an order that makes sense for actually doing it (a merge conflict
usually needs resolving before check failures on top of it can even be
diagnosed cleanly; review-feedback fixes and check fixes can often be
described together where they overlap the same file or the same root
cause). The point is a plan a person would actually write if they sat
down and looked at the whole PR at once, not a mechanical stitch of
whatever three sub-tools happened to output.

If none of the three found anything to raise, there's no comment to
post — say so and stop.

If exactly one of the three found something, that alone is already
"the plan" — post it, in its own drafted shape, without inventing extra
structure around a single item.

If more than one found something, write the holistic plan and post it as
one comment, roughly:

> @copilot here's what this PR needs before it's mergeable:
>
> 1. {first thing to do, with enough detail to act on it, and a link
>    where useful}
> 2. {next thing, and so on — ordered sensibly, not just grouped by
>    which check produced it}

Post it once. This is the entire point of
holding the comments back in Step 1 — Copilot gets one notification per
pass on this PR, with one clear plan, not up to three fragmented asks.

## Report

No tables — a short, plain summary of this one PR, rolling up what each
part of Step 1 turned up:

- The PR's title and URL.
- If the gate failed: say so and stop there.
- What was reran as volatile, and what was left as real/unclear.
- Whether non-volatile check failures were found.
- Whether the PR was conflicted, and if so, whether it was skipped as
  automation, skipped as already in flight, or included in the plan.
- Counts resolved as noise, suggestions applied, and — importantly —
  every genuinely-unsure review item with its link, since that's the
  part a human still needs to read themselves.
- Whether a holistic Copilot comment was posted, and a link to it if so.
- Anything that errored along the way, named explicitly.

## Things this skill does not do

Doesn't promote a draft PR to ready for review or arm auto-merge — that
behavior isn't covered by any of the four sibling skills this
orchestrator composes, so it's out of scope here too; reach for that
separately if it's still needed. Doesn't reassign a PR whose coding-agent
session has silently died — see `github-pr-reassign-broken-copilot` for
that; a PR in that state is better served by that skill than by posting
a Copilot instruction nobody's listening for. Doesn't do anything none
of the four sibling skills would do on their own — this skill only adds
the sequencing, the "hold the comment back" step, and the holistic
synthesis into one plan.
