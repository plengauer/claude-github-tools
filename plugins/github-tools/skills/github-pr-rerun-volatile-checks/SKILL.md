---
name: github-pr-rerun-volatile-checks
description: >
  Find CI checks that failed on a single GitHub pull request's head
  commit, read their logs, classify each failure as volatile (worth a
  rerun — rate limits, registry flakiness, transient 5xx, cancelled
  runner) or not, and rerun only the volatile ones. Scoped to exactly one
  PR per invocation. Use whenever the user asks to "rerun failed checks
  on this PR", "retry CI", "this PR's checks failed, can you look", or as
  one step of broader per-PR maintenance.
compatibility: >
  Needs a way to list checks for a PR's head commit, fetch a workflow
  job's log, and rerun failed jobs — GitHub REST covers all three
  (Checks + Actions APIs). A `statusCheckRollup` or `status:failure`
  search works as a starting aggregate. Also needs `github-pr-volatile-
  failure-detection`.
---

# GitHub PR Rerun Volatile Checks

Reruns CI checks that failed for a reason that plausibly won't recur —
and only those. Never reruns a genuine test failure, compile error, or
lint violation; a wrong rerun costs CI time and delays finding the real
bug. Deciding what to do about a genuine (non-volatile) failure is
deliberately out of scope here — that's `github-pr-fix-checks`.

This skill describes *what* to check and *when to act*, not which
specific tool call does it. Use whatever's available in the current
session — a broad GitHub connector, the Actions/Checks API directly, a
CLI, or browser control.

## Scope: one PR

This skill operates on exactly one PR per invocation — given as a URL or
`owner/repo#123`. It doesn't expand a repo or a list into multiple PRs;
a caller that wants this applied across several PRs invokes it once per
PR.

## Gate: at least one commit

Before anything else, confirm the PR has at least one commit. A PR with
literally zero commits has nothing to have checks on — stop immediately
and report that plainly rather than proceeding. Everything below assumes
this gate has passed.

## Step 0: Gather state

Every check (CI job, status check) attached to the PR's head commit,
along with whether each finished and how it concluded. A combined-status
field, a search qualifier like `status:failure`, or GraphQL's
`statusCheckRollup` is fine as a starting point, but treat it as a hint,
not ground truth — these aggregates are known to lag or misclassify,
especially for checks backed by Actions runs that were
cancelled-and-superseded rather than cleanly failed, or that finished
after the aggregate was last computed. If something looks off — the
count looks wrong, a check the person specifically mentioned isn't
showing up as failed, or the aggregate calls something "pending" that's
clearly finished — fall back to the more literal path: resolve the PR's
head branch to its current head commit SHA, then list the workflow (or
check) runs actually associated with that SHA directly, and read each
run's own conclusion. This is slower and can return verbose output, so
it's a fallback for when the aggregate is in doubt, not the default
first move.

## Task: rerun volatile failures

Keep the checks that actually failed (a hard failure or a timeout) —
leave cancelled, skipped, neutral, successful, and action-required
checks alone, and skip anything still in progress.

For each failed check, work out whether it's backed by a CI job you can
target directly for logs and a rerun. GitHub Actions-backed checks
typically carry a details link shaped like a run id and a job id
together (e.g. `.../actions/runs/{run_id}/job/{job_id}`) — when you see
that shape, it tells you exactly what to target. When a failed check
doesn't have that shape (an older-style check, or a third-party CI app
posting its own status), there's no generic rerun mechanism to reach for
— note it as needing manual attention rather than guessing at one.

For each rerunnable failed job:

1. Fetch its log output. Depending on what's available this may come
   back as text directly or as something you need to follow up on.
2. Read it. For a noisy job (dependency installs, build output can run
   hundreds of lines) GitHub Actions marks the actual failure with an
   `##[error]` line of its own — search for that and read the
   surrounding context rather than the whole log top to bottom.
3. Classify the failure using the `github-pr-volatile-failure-detection`
   skill: `volatile`, `real`, or `unclear`. When it doesn't clearly match
   either pattern list there, that skill returns `unclear` — don't
   second-guess it into a rerun.
4. If every failed job in a given run is judged volatile, rerunning that
   run's failed jobs together in one action is more efficient than doing
   them one by one. If only some jobs in that run are volatile, rerun
   just those individually — rerunning the whole run would also
   re-trigger the genuinely broken job for nothing.

Leave debug logging off by default; that's for the person to turn on
deliberately when troubleshooting, not something to enable on their
behalf.

Jobs classified `real` or `unclear` are left exactly as they are — don't
comment, don't request changes, don't do anything else with them here.
Just record what they were classified as so the report below can name
them; a caller that wants them acted on reaches for `github-pr-fix-
checks` next.

Mention retry counts in the report if this isn't the PR's first pass
through this skill. If something keeps coming back as "volatile" across
repeated runs, that's worth surfacing rather than quietly retrying
forever — it may not be as transient as it looks.

## Report

No tables — a short, plain summary of this one PR:

- The PR's title and URL.
- If the gate failed: say so and stop there.
- If nothing failed: say so ("all checks green" or "still running,
  nothing failed yet").
- For each job that was reran: the check name, why it was classified
  volatile (the matched pattern), and whether the rerun call succeeded.
- For each job left alone: the check name and its classification (`real`
  or `unclear`) so the reader knows it still needs attention elsewhere —
  don't restate the whole log, one line is enough.
- If a rerun swept up a `real`/`unclear` job from the same run alongside
  a volatile one (see Task, point 4), say so explicitly — that job is
  now back in progress too, as a side effect, not because it was
  reclassified.

## Things this skill does not do

Doesn't decide what to do about non-volatile failures beyond naming them
— see `github-pr-fix-checks` for the deep analysis and Copilot
instruction that follows a `real` or `unclear` classification. Doesn't
touch merge conflicts, review threads, formal reviews, auto-merge, or
draft state. Doesn't wait for a triggered rerun to finish — this skill's
job ends once the rerun call is made; a later pass picks the PR back up
once its state has moved.
