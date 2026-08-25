---
name: github-pr-approve-automation
description: >
  Submit an approving review on a single GitHub pull request if it's
  self-updating automation (Renovate, version-bump, OTel-deploy,
  workflow-recompile, and similar) and doesn't already have one, so
  auto-merge can clear its review gate. Leaves an ordinary human-authored
  PR or one already changes-requested alone. Scoped to exactly one PR per
  invocation. Use whenever the user asks to "approve this automation
  PR", "clear the review gate on this Renovate PR", or as one step of
  broader per-PR maintenance.
compatibility: >
  Needs a way to list a PR's formal reviews (state + author) and submit
  an approving review — GitHub's REST or GraphQL API covers both. Note
  that GitHub does not let a PR's author approve their own PR (see the
  Task section below) — this is a platform rule, not a tool limitation.
  Also needs the `github-pr-automation-detection` skill to classify the
  PR.
---

# GitHub PR Approve Automation

Approves a PR only if it's the narrow, low-risk, unattended automation
kind the user already trusts to run without a human writing the diff.
Leaving an ambiguous PR unapproved costs a few minutes waiting for a
human glance; approving something that wasn't actually safe, unattended
automation waves through a change nobody looked at. That asymmetry
governs every judgment call in this skill.

This skill describes *what* to check and *when to act*, not which
specific tool call does it. Use whatever's available in the current
session — a broad GitHub connector, the REST/GraphQL API directly, a
CLI, or browser control.

## Scope: one PR

This skill operates on exactly one PR per invocation — given as a URL or
`owner/repo#123`. It doesn't expand a repo or a list into multiple PRs;
a caller that wants this applied across several PRs invokes it once per
PR.

## Gate: at least one commit

Before anything else, confirm the PR has at least one commit. A PR with
literally zero commits isn't a real candidate yet — stop immediately and
report that plainly rather than proceeding. Everything below assumes
this gate has passed.

## Step 0: Gather state

- Whether the PR is self-updating automation — consult the
  `github-pr-automation-detection` skill for the classification.
- Every formal review submitted on the PR (distinct from comment
  threads) and each one's state (approved, changes-requested, commented,
  pending, dismissed) and author.

## Task: approve if eligible

Uses the classification from the `github-pr-automation-detection` skill:
this PR only qualifies here if it's classified `automation`. A PR
classified `coding-agent` or `human` — including anything that doesn't
clearly match a known signature — stays out of scope, don't guess; stop
and report it as not eligible.

If it is `automation`:

- If the PR already carries an **approved** review from anyone, there's
  nothing to do — report it as already approved.
- If it carries a **changes-requested** review that no later review from
  that same person has superseded, leave it alone — a human already
  objected to this specific PR, and matching an automation pattern
  doesn't override that. Report it as skipped, with the reason.
- Otherwise, submit an approving review (GitHub's `APPROVE` event). No
  review body is needed — an empty-body approval is valid, so don't
  compose one just to have something to say.

Expect the approval itself to fail often, for a structural reason rather
than a tool problem: several of the automation categories here
(version-bump, OTel-deploy, workflow-recompile, self-hosted Renovate)
open their PRs under **the repo owner's own account** rather than a
separate bot account (see the `github-pr-automation-detection` skill),
and GitHub does not let a PR's author approve their own PR — a hard
platform rule, confirmed in GitHub's own docs, not a permission that can
be granted. If the acting credentials are that same account, expect a
422 along the lines of "can not approve your own pull request" (exact
wording isn't guaranteed, so match loosely). Don't burn retries
escalating through the GitHub tool ladder chasing this — no tier gets
around a platform rule. Report it plainly as skipped because the acting
account is the PR's author, distinct from an actual failure; it's a
genuine signal that this one needs the user, or a second reviewer, to
click approve themselves. PRs from a truly separate bot account
(`renovate[bot]`, `dependabot[bot]`) don't run into this.

## Report

No tables — a short, plain summary of this one PR:

- The PR's title and URL.
- If the gate failed: say so and stop there.
- Whether it was classified automation, and if not, that it's out of
  scope.
- If automation: whether it was already approved, approved just now, or
  left alone (changes-requested outstanding, or the acting account is
  the PR's author) — say which, and why.
- If the approve call itself errored for a reason other than the
  self-approval platform rule, say what errored.

## Things this skill does not do

Doesn't touch auto-merge, checks, conversations, or rebases — see the
sibling skills `github-pr-rerun-volatile-checks`, `github-pr-fix-checks`,
`github-pr-handle-change-requests`, and `github-pr-rebase-conflicted`
for those. The only review event this skill ever submits is a plain
approval — it never requests changes, dismisses someone else's review,
or leaves review comments on anyone's behalf.
