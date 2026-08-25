---
name: github-pr-handle-change-requests
description: >
  Evaluate every review and every review thread/conversation on a single
  GitHub pull request — bot-authored (Copilot, Dependabot, GitHub
  Actions, CodeQL, Snyk, and similar) and human-authored alike — and
  handle each on its merits: resolve the ones that are noise or already
  moot with an explanatory reply, directly apply a suggested change when
  one is attached and clearly correct, ask Copilot to fix what needs
  fixing but has no ready-made suggestion, and surface anything genuinely
  ambiguous as a link for a human to judge rather than guessing. Scoped
  to exactly one PR per invocation. Use whenever the user asks to "clean
  up review comments on this PR", "triage the conversations on this PR",
  "deal with the bot noise on this PR", "handle the change requests on
  this PR", or as one step of broader per-PR maintenance.
compatibility: >
  Needs a way to list a PR's reviews and review threads with resolved
  state, read comments/replies and head-commit file content, post a
  reply, resolve a thread, apply a suggested change, and post a PR
  comment. GraphQL exposes thread resolution; REST covers the rest.
---

# GitHub PR Handle Change Requests

Goes through everything reviewers — human or automated — have said about
a single PR and moves each item to a real conclusion instead of leaving
it sitting unresolved indefinitely. Every unresolved thread and every
outstanding review lands in exactly one of four buckets:

1. **Noise or already moot** → resolve it, with a short reply explaining
   why.
2. **Real, and the fix is a concrete attached suggestion** → apply the
   suggestion directly.
3. **Real, but no ready-made suggestion to apply** → ask Copilot to fix
   it (drafted, not necessarily posted immediately — see "Combining and
   posting" below).
4. **Genuinely unsure** → don't act. Surface it as a direct link so a
   human can make the call.

This skill describes *what* to check and *when to act*, not which
specific tool call does it. Use whatever's available in the current
session — a broad GitHub connector, GraphQL/REST directly, a CLI, or
browser control.

## Scope: one PR

This skill operates on exactly one PR per invocation — given as a URL or
`owner/repo#123`. It doesn't expand a repo or a list into multiple PRs;
a caller that wants this applied across several PRs invokes it once per
PR.

## Gate: at least one commit

Before anything else, confirm the PR has at least one commit. A PR with
literally zero commits has nothing to have reviews or conversations on
yet — stop immediately and report that plainly rather than proceeding.
Everything below assumes this gate has passed.

## Step 0: Gather state

Every review thread/conversation on the PR (resolved or not) and every
formal review (its state — `APPROVED`, `CHANGES_REQUESTED`, `COMMENTED`
— and its author). Note, for each thread and review, whether the author
looks like automated tooling — `copilot` / `github-copilot[bot]` /
`copilot-pull-request-reviewer[bot]`, `dependabot` / `dependabot[bot]`,
`github-actions[bot]`, anything containing `codeql`, anything containing
`snyk`, matched case-insensitively — versus a human. This distinction
matters for how high a bar to hold the content to, not for whether it
gets looked at; both kinds go through the same four buckets below.

Leave already-resolved threads and `APPROVED` reviews with nothing left
to act on alone entirely — this skill only touches unresolved threads
and reviews still carrying an actionable state (`CHANGES_REQUESTED`, or
`COMMENTED` with a body that reads as asking for something).

## Task: judge each thread and review

For each unresolved thread and each actionable review, read the body,
any replies, and — if needed to judge whether it's still accurate — the
current file content at the PR's head commit. The question is always
"is this still a real, open concern, and if so, how confidently do I
know what to do about it?"

**Bucket 1 — noise or moot, resolve with a reply:**
- The bot clearly misread the code (flagged a function as unused when
  it's used elsewhere, flagged a "missing await" on a synchronous
  function, and similar).
- A security/lint scanner flagging a pattern that's safe in context
  (`Math.random()` for non-cryptographic use, `eval` inside a sandboxed
  evaluator that's the literal point of the code, a hardcoded credential
  in an obvious test fixture — filenames like `*test*`, `*fixture*`,
  `*mock*`, `*example*`).
- A dependency-vulnerability advisory on a transitive dependency
  reachable only in dev/test code.
- A style/naming suggestion that conflicts with consistent existing
  convention in the same file or repo.
- A purely informational comment with no actual issue attached.
- For human-authored threads specifically, hold this bucket to a much
  higher bar than for bots: only place a human thread here when the
  thread's own content makes it clearly moot — the flagged code no
  longer exists, or the human already said it's handled. A thread marked
  "outdated" by the diff having moved is a useful signal, not proof —
  check it before relying on it.

**Buckets 2 and 3 — real concern, confidently correct:**
Anything pointing at a genuine bug, security issue, correctness problem,
or a reasonable requested change that the current code doesn't already
address.
- If the thread or review carries a concrete suggested change (a
  GitHub suggestion block, or a review with an unambiguous specific
  diff implied) and applying it as-is is clearly correct and safe →
  **Bucket 2**: apply it directly.
- If it's a real concern but there's no ready-made suggestion to apply —
  the fix requires judgment, spans more than the flagged lines, or the
  comment describes a problem without prescribing the exact fix →
  **Bucket 3**: this becomes an item in the drafted Copilot instruction
  (see "Combining and posting").

**Bucket 4 — genuinely unsure, don't act:**
Anything where you can't confidently place it in bucket 1, 2, or 3 —
including any human-authored thread that isn't clearly moot but also
isn't clearly a well-specified fix. Bias toward this bucket over
guessing: the cost of leaving something here is a link in the report;
the cost of misfiling a real issue as noise, or misapplying a bad
suggestion, is much higher.

## Acting on each bucket

**Bucket 1:** Post a short (one or two sentence), factual reply on the
thread explaining why it's being resolved. Post the reply, then
resolve the thread. If the reply post fails, don't resolve — leave the
thread and report it as an error instead. Never comment on a thread
that's being left open — this reply only happens immediately before a
resolve. Never edit or repost an existing comment. For a `CHANGES_REQUESTED`
review that turns out to be moot in its entirety (not just one thread on
it), the equivalent action is a reply comment on the PR explaining why,
rather than a thread resolve — reviews aren't resolved the way threads
are.

**Bucket 2:** Apply the suggested change exactly as specified — commit
it via whichever mechanism the current tooling exposes for "apply
suggestion," or, if nothing that specific is available, make the
equivalent direct edit to the file at the PR's head and push it as a
commit on the PR's branch. Then reply on the thread noting the
suggestion was applied, and resolve it. If
applying it fails for any reason, don't guess at a workaround — fall
back to treating it as Bucket 3 instead (draft a Copilot instruction
naming the suggestion and why it couldn't be applied automatically).

**Bucket 3:** Don't post anything yet — produce one drafted item per
thread/review: what needs fixing, where (file/line when the thread
already anchors one), and why, in your own words rather than a copy of
the whole comment. These get combined below.

**Bucket 4:** Don't act and don't comment. Produce one reported item: a
direct link to the thread or review, and a one-line description of what
it's asking, so a human can open it and judge without having to hunt for
it.

## Combining and posting

Collect every Bucket 3 item into a single drafted instruction — one
message, not one comment per item:

> @copilot this PR has review feedback that needs addressing:
>
> - {thread/review link}: {what's being asked and why}
> - {another item, same shape}

Post this as a single plain comment on the PR (not a formal review —
see the same reasoning in `github-pr-fix-checks`) once all Bucket 3
items are collected. This, the Bucket 1 reply-then-resolve actions, and
the Bucket 2 apply-then-resolve actions are the only mutations this
skill performs.

If there are no Bucket 3 items, there's nothing to draft or post for
this step.

## Report

No tables — a short, plain summary of this one PR:

- The PR's title and URL.
- If the gate failed: say so and stop there.
- Count resolved as noise/moot (Bucket 1), with one line each on why.
- Count where a suggestion was applied (Bucket 2), with a link to each.
- Whether a Copilot instruction was drafted for Bucket 3 items, and if
  posted directly, a link to the comment.
- Every Bucket 4 item as its own line: the link, and the one-line
  description of what it's asking — this is the list a human should
  actually read.
- Anything that errored (a reply, resolve, apply, or post call itself
  failing) named explicitly, separate from the buckets above.

If nothing was found at all (no unresolved threads, no actionable
reviews), say that plainly in one sentence — don't pad.

## Things this skill does not do

Doesn't touch checks, volatile-failure reruns, merge conflicts, auto-
merge, or draft state — see `github-pr-rerun-volatile-checks` and
`github-pr-fix-checks` for those. Never submits a formal review,
dismisses someone else's review, or edits/reposts an existing comment.
Doesn't re-scan for a fresh run within the same pass — if invoked
repeatedly on a PR whose state hasn't changed, expect Bucket 1/2 actions
to be idempotent (already-resolved threads are skipped at Step 0) but a
fresh Bucket 3 comment each time unless the calling context dedupes on
that itself.
