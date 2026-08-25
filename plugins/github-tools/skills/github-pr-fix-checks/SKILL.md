---
name: github-pr-fix-checks
description: >
  Deeply analyze CI check failures on a single GitHub pull request's head
  commit that failed for a real (non-volatile) reason, and instruct
  Copilot to fix them via a plain comment (never a formal review).
  Pinpoints the file/line where the log analysis supports it, and
  otherwise falls back to a link to the failing check. Scoped to exactly
  one PR per invocation. Use whenever the user asks to "get Copilot to
  fix this PR's failing checks", "why is this PR failing and can you get
  it fixed", or as one step of broader per-PR maintenance.
compatibility: >
  Needs a way to read a PR's checks and job logs for its head commit and
  to post a comment on it — GitHub's REST API covers both. Also needs
  the `github-pr-volatile-failure-detection` skill to rule out volatile
  causes.
---

# GitHub PR Fix Checks

Looks at CI checks currently failing on a PR's head commit for a real
reason — not volatile flakiness, which `github-pr-rerun-volatile-checks`
already handles — and gets Copilot working on the fix.

This skill describes *what* to check and *when to act*, not which
specific tool call does it. Use whatever's available in the current
session — a broad GitHub connector, the REST API directly, a CLI, or
browser control.

**Never posts a formal review** (no `REQUEST_CHANGES`, no review event
of any kind) — only a plain issue comment. This is a deliberate
difference from older approaches to this problem: a review changes the
PR's review-gate state and shows up differently in notifications than a
comment does, and the intent here is just "leave Copilot a note," not
"put up a review other tooling has to account for."

## Scope: one PR

This skill operates on exactly one PR per invocation — given as a URL or
`owner/repo#123`. It doesn't expand a repo or a list into multiple PRs;
a caller that wants this applied across several PRs invokes it once per
PR.

## Gate: at least one commit

Before anything else, confirm the PR has at least one commit. A PR with
literally zero commits has nothing to have checks on yet — stop
immediately and report that plainly rather than proceeding. Everything
below assumes this gate has passed.

## Step 0: Gather state

Every check attached to the PR's head commit and how each concluded.
Treat an aggregate rollup as a hint, not ground truth (it can lag or
misclassify runs that were cancelled-and-superseded); fall back to
resolving the head branch's current SHA and listing runs for that SHA
directly if something looks off.

## Task: analyze non-volatile check failures

Keep the checks that actually failed (a hard failure or timeout) — leave
cancelled, skipped, neutral, successful, and action-required checks
alone, and skip anything still in progress.

For each failed check backed by a job you can fetch logs for:

1. Fetch its log. GitHub Actions logs mark the actual failure with an
   `##[error]` line of its own — search for that and read the
   surrounding context rather than the whole log top to bottom.
2. Classify it using the `github-pr-volatile-failure-detection` skill.
   **Skip anything classified `volatile`** — that's `github-pr-rerun-
   volatile-checks`'s job, not this one. Continue only with `real` and
   `unclear` classifications.
3. For each `real` or `unclear` failure, dig past the classification
   into what actually broke: the specific assertion, the specific
   compile error, the specific line the stack trace points to. The goal
   is to hand Copilot something more useful than "the build failed" —
   ideally the exact file, line, and reason.
4. A failed check with no fetchable log (an older-style check, or a
   third-party CI app posting its own status) can't be analyzed this
   way — note it by name and fall back to linking its details page
   instead.

For each analyzed failure, produce one short item: what's failing
(check name), where (file/line if the log pinpointed one), why (the
specific error, not a restatement of the whole log), and a link to the
run/job as a fallback for anything the analysis couldn't pin down more
precisely.

## Drafting the instruction

If the task above produced any items, combine all of them into a single
drafted instruction, not one message per item. Shape it roughly like:

> @copilot this PR has failing checks that need fixing:
>
> - {check name}: {what's wrong}, at {file:line if known} — see
>   {run/job link}
> - {another check, same shape}

Keep each item factual and specific — what's wrong and where to look —
not a restatement of an entire log.

If nothing was found (checks are all volatile, passing, or still
running), there's no instruction to draft — say so plainly and stop.

Post the drafted instruction as a single plain issue comment on the PR.
This is the only mutation this skill performs.

## Report

No tables — a short, plain summary of this one PR:

- The PR's title and URL.
- If the gate failed: say so and stop there.
- Whether any non-volatile check failures were found, and how many.
- Whether an instruction was drafted, and if posted directly, a link to
  the comment.

## Things this skill does not do

Doesn't touch volatile-failure reruns (`github-pr-rerun-volatile-
checks`), merge conflicts (`github-pr-rebase-conflicted`), review
threads or formal reviews (`github-pr-handle-change-requests`),
auto-merge, or draft state. Doesn't re-post an instruction that's
already outstanding and unaddressed; if invoked standalone and repeated
on a PR whose state hasn't changed since the last pass, expect a
duplicate comment unless the calling context dedupes on that itself.
