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
  Step 3 section below) — this is a platform rule, not a tool limitation.
  Also needs the `github-pr-automation-detection` skill to classify the
  PR, which in turn needs read access to the repo's workflows and their
  runs.
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

## Gates

Check these first, in order, and stop at the first that fails — report
it plainly rather than proceeding. Everything below assumes they passed.

1. **At least one commit.** A PR with literally zero commits isn't a real
   candidate yet.
2. **Open and ready.** The PR must be open — not closed, not already
   merged — and not a draft. Approving a closed or merged PR does
   nothing useful, and a draft is by definition not yet asking to be
   merged, so auto-merge has nothing to clear.

## Step 1: Is it already approved — in a way that counts?

The point of approving is to clear the review gate, so the question is
not "does an approval exist" but "is the review requirement already
satisfied".

- **Preferred:** if the means you're using exposes GitHub's own overall
  review decision for the PR (the same verdict branch protection and
  rulesets use), go by that. If it says approved, there's nothing to do —
  report it as already approved and stop.
- **Otherwise, judge the individual reviews.** An existing approval only
  counts if all of these hold:
  - It's still in effect — not dismissed, and not superseded by a later
    changes-requested review from the same person.
  - Its author is someone whose approval counts for the base branch —
    at least write access to the repo (an approval from an outside
    account without it doesn't satisfy branch protection), and a code
    owner if the base branch requires code-owner review for the files
    touched.
  - If the base branch dismisses stale approvals or requires approval of
    the most recent push, it was submitted on the PR's **current** head
    commit. An approval on an older commit doesn't count under those
    rules.

  If you can't see branch protection or ruleset settings, assume the
  strict reading — an approval on an older commit doesn't count — since
  approving again is harmless, while wrongly reporting "already
  approved" leaves auto-merge stuck with nobody noticing.

If a counting approval exists, report already approved and stop. If one
exists but doesn't count, carry on, and say in the report which one was
there and why it didn't count.

## Step 2: Classify

Consult the `github-pr-automation-detection` skill. This PR only
qualifies if it's classified `automation`. A PR classified `coding-agent`
or `human` — including anything that doesn't clearly match a known
signature, or fails its author or workflow checks — stays out of scope,
don't guess; stop and report it as not eligible, with the reason the
classifier gave.

Keep the **head commit SHA** the classifier reports — that's the commit
whose diff was actually looked at.

## Step 3: Approve if eligible

- If the PR carries a **changes-requested** review that no later review
  from that same person has superseded, leave it alone — a human already
  objected to this specific PR, and matching an automation pattern
  doesn't override that. Report it as skipped, with the reason.
- Otherwise, submit an approving review (GitHub's `APPROVE` event). No
  review body is needed — an empty-body approval is valid, so don't
  compose one just to have something to say.

**Approve exactly the commit that was classified.** Automation pushes
new commits on its own (Renovate rebases, version bumps re-run), so the
head can move between classification and approval, and an approval
landing on an unclassified diff waves through a change nobody looked at.

- If the means you're using lets you name the commit a review applies to,
  name the classified head commit SHA — never "whatever the head is now".
- Either way, re-read the PR's head right before approving. If it no
  longer matches the classified SHA, don't approve: report that the head
  moved since classification and that the PR needs a fresh pass. (With
  the commit named, a push in the instant after this check is harmless —
  the approval still lands on the commit that was classified, and the
  review gate simply re-evaluates for the new head.)

Expect the approval itself to fail often, for a structural reason rather
than a tool problem: several of the automation categories here
(version-bump, OTel-deploy, workflow-recompile, self-hosted Renovate,
backports)
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
- If a gate failed: which one (no commits, closed, merged, draft) — and
  stop there.
- If it was already approved: say so, and whose approval satisfied it.
  If an approval existed but didn't count, say why it didn't.
- Whether it was classified automation, and if not, that it's out of
  scope and which check it stopped at.
- If automation: whether it was approved just now (and on which commit),
  or left alone — changes-requested outstanding, the acting account is
  the PR's author, or the head moved since classification — say which,
  and why.
- If the approve call itself errored for a reason other than the
  self-approval platform rule, say what errored.

## Things this skill does not do

Doesn't touch auto-merge, checks, conversations, or rebases — see the
sibling skills `github-pr-rerun-volatile-checks`, `github-pr-fix-checks`,
`github-pr-handle-change-requests`, and `github-pr-rebase-conflicted`
for those. The only review event this skill ever submits is a plain
approval — it never requests changes, dismisses someone else's review,
or leaves review comments on anyone's behalf.
