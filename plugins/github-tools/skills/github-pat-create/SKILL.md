---
name: github-pat-create
description: >
  Create a new fine-grained GitHub personal access token scoped to one
  or more specific repositories, with an explicit permission set and an
  expiry given either as an absolute date or a relative duration. Use
  whenever the user asks to "create a PAT", "make me a token for repo
  X", "I need a token with read access to issues on these two repos",
  "generate a fine-grained token that expires in 90 days", or anything
  that implies minting new GitHub credentials — including as one step of
  setting up automation, CI, or a local tool that needs a token.
compatibility: >
  Needs a way to create a fine-grained personal access token, and to
  list the account's existing tokens with their expiry dates in order
  to verify the result and to clean up expired ones. Note that GitHub's
  API surface does not expose fine-grained token creation, so expect to
  reach for a lower tier of the escalation ladder than usual.
---

# GitHub PAT Create

Mints one fine-grained token with the narrowest scope that does the
job, and hands it back exactly once.

This skill describes *what* needs to happen, not which specific tool
does it — use whatever the session offers, following the usual
escalation ladder.

## Inputs

- **scope** — one or more repositories, as `owner/repo`. Fine-grained
  tokens are repository-selected by design; don't widen this to "all
  repositories" as a convenience, even if selecting several feels
  tedious. A token that can reach repos nobody asked about is the whole
  problem fine-grained tokens exist to solve.
- **permissions** — the permission set, each with an access level
  (typically read or read-and-write). Take these literally. If the user
  names a capability rather than a permission ("needs to comment on
  PRs"), map it to the narrowest permission that covers it and say
  which one you picked, so they can correct you.
- **expiry** — either an absolute date (`2027-03-01`) or a relative
  duration ("90 days", "6 months", "end of the year"). Resolve relative
  input to a concrete date before creating anything, and state the date
  you resolved it to. GitHub caps how long a fine-grained token may
  live, and an organization can enforce a shorter maximum; if the
  requested expiry exceeds what's allowed, use the longest permitted
  date and tell the user you shortened it rather than silently failing.

## One resource owner per token

A fine-grained token belongs to exactly one resource owner — your own
account, or a single organization — and can only select repositories
belonging to that owner. So before creating anything, group the
requested repositories by owner:

- All one owner → one token, resource owner set accordingly.
- Several owners → this cannot be one token. Say so, and create one
  token per owner only if the user confirms; don't quietly produce
  three tokens when they asked for one.

When the resource owner is an organization, the org may require
approval before the token becomes usable. The token is created in a
pending state and won't work until an owner approves it. Report that
clearly instead of handing over a token that looks fine and fails on
first use.

## When the token limit blocks creation

GitHub caps how many fine-grained tokens an account can hold. If
creation fails because that cap is reached, you may free a slot — but
only by deleting tokens that have **already expired**.

An expired token is already dead: nothing depends on it working,
because it doesn't work. Deleting it costs nothing and needs no
confirmation. So: list the account's tokens, identify the ones whose
expiry date is in the past, delete as many as needed to make room, and
mention in the report which ones you removed.

**Never delete a token that has not expired.** Not one that looks
unused, not one with a vague or stale-sounding name, not one that
appears to duplicate the token you're about to create, and not the
oldest one just because it's the oldest. You cannot see what depends on
a live token, and revoking one breaks CI, deploys, or a colleague's
tooling in ways that are hard to trace back to you. If there are no
expired tokens to reclaim, stop and report that the limit is reached,
listing the tokens and their expiry dates so the user can decide what
to revoke themselves. Deciding to kill a live credential is theirs to
make, not yours.

## Handling the token value

The token value is shown once and cannot be retrieved again. Give it to
the user directly in your response, and nowhere else: never write it to
a file, a commit, an issue or PR comment, a secret store the user
didn't ask for, or any log or scratch note. If they want it stored
somewhere — a repo secret, for instance — let them ask for that as a
separate step.

## Verifying

After creation, list the account's tokens and confirm the new one is
present with the repositories, permissions and expiry date that were
requested. Permission sets are the easiest thing to get subtly wrong —
one level too broad, or a permission silently dropped — so check them
against the request item by item rather than trusting that the create
succeeded.

## Report

A short plain summary — no tables:

- The token name, its resource owner, the repositories it covers, the
  permissions and levels granted, and the resolved expiry date.
- Whether the expiry was shortened, or a capability mapped to a
  permission you chose.
- Whether it's pending organization approval.
- Any expired tokens you deleted to make room.
- The token value itself, flagged as shown-only-once.

## Things this skill does not do

Doesn't create classic (non-fine-grained) tokens, GitHub App
installations or OAuth apps; doesn't approve pending organization token
requests; doesn't revoke, regenerate or extend live tokens; doesn't
store the token anywhere or wire it into CI. For automation that
outlives a token's expiry, a GitHub App is usually the better answer —
worth mentioning if the user's use case looks like that.
