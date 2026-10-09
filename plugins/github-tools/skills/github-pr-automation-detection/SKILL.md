---
name: github-pr-automation-detection
description: >
  Classify whether a GitHub pull request was opened by self-updating
  automation (Renovate, version-bump, OTel-deploy, workflow-recompile,
  backport, and similar) versus a human or a coding agent like
  Copilot/Claude/Codex — and return that classification for another skill
  or task to act on. Runs in three phases: a cheap metadata fast path
  (author gate, title, body, assignee, branch), a mandatory diff-shape
  check, and a mandatory check that a workflow in the repo actually
  produced the PR, all before any PR may be labelled automation. This
  skill does not take any action itself; it's a classifier other skills
  consult before deciding whether to arm auto-merge, ask for a rebase,
  auto-approve, or approve a stuck workflow run. Use whenever a task needs
  to know "is this PR automation?" for a specific pull request, or "which
  of these open PRs are automation?" across a repo.
---

# GitHub PR Automation Detection

A classifier, not an action. Given a pull request, decide which of three
buckets it falls into — **self-updating automation**, **coding agent**
(Copilot, Claude, Codex, or similar), or **ordinary human PR** — and hand
that back. What the calling skill does with the answer (arm auto-merge,
ask for a rebase, approve it, approve a stuck run) is out of scope here.

Work the phases in order and stop at the first one that settles the
question. Phase 1 is metadata only and cheap. Phases 2 and 3 cost a diff
fetch and a look at the repo's workflows and runs, and **both are
mandatory** before any PR is labelled `automation` — metadata is a filter,
the diff is the evidence of *what* changed, and a matching workflow run is
the evidence of *who* changed it.

Every check here errs the same way: when it isn't obvious, the answer is
`human`. A false `human` costs a human a glance; a false `automation` lets
a change through that nobody looked at.

## Why this is not obvious

Several of these automations run under the **owner's own personal
account** (via a PAT), not a distinct bot account — so checking whether
the author is flagged as a bot account alone will miss most of them.
This was confirmed by pulling real examples rather than assumed; if
these patterns stop matching (an automation gets renamed, a new one is
added), update this skill rather than guessing in the moment.

## Pin the head commit

Before Phase 2, note the PR's current **head commit SHA**. The diff in
Phase 2 and the run in Phase 3 are judged against that exact commit, and
it's reported back in the output so a caller acting on the verdict (an
approval, say) can act on the same commit that was classified rather than
whatever the head has moved to since.

## Phase 1 — metadata fast path

Read only: **title**, **body/summary**, **creator (author)**,
**assignees**, the **base branch**, and the **branch name**. Nothing else
is fetched yet.

### 1a. Coding agent — creator or assignee is an agent

- **Copilot coding agent** — login `Copilot`, app `copilot-swe-agent`.
- **Claude code agent** — login `Claude`, app `anthropic-code-agent`.
- **Codex** and other agents of the same shape.

A PR opened by, or assigned to, one of these is a coding agent PR. These
are one-off code-change PRs, same as a human's — nothing regenerates them
on a schedule. **Return `coding-agent` and stop; no further check applies.**

A calling skill that only cares about the narrower "is this Copilot's own
PR?" question (rather than the full self-updating-automation
classification) should check only against this bucket, not the automation
signals below — those are two different questions even though both live
in this skill.

### 1b. Author gate — hard requirement

An automation PR's author must be **one of exactly two things**. If it's
neither, **return `human` and stop** — no diff check, no workflow check.

**(i) The repository's owner.** The account the repo belongs to, on the
assumption that the automation pushes with the owner's PAT. For a
user-owned repo that's the owning user. An org-owned repo has no personal
owner account, so this branch never matches there — only (ii) can. Other
collaborators with write access do **not** qualify here, even though they
could in principle run automation with their own PAT; that's the kind of
"not obvious" case this gate exists to turn away.

An owner-authored PR additionally needs **no assignee at all** to stay a
candidate: a scheduled workflow pushing under the owner's token opens the
PR as the owner and never assigns anyone. Unassigned owner PRs are common
too, so this shape alone is *never* a verdict — it only gets the PR into
the later phases.

**(ii) A login that is obviously an automation.** Judge the name, don't
match a list. The question is whether the account name describes a
*function* (updating, building, releasing, deploying, syncing) rather
than identifying a human. Illustrative examples, deliberately **not** a
closed set: `github-actions[bot]`, `renovate[bot]`, `dependabot[bot]`,
`mend-*`, `imgbot`, `allcontributors[bot]`, and generally anything
carrying a `[bot]` suffix or reading like `*-bot`, `*-ci`, `*-updater`,
`*-automation`, `*-release`, `*-sync`. A login never seen before that
plainly reads like a service name qualifies exactly as well as any name
listed here. An account whose GitHub type is `Bot` also qualifies.

"Obviously" carries weight. A login that *might* be a service account but
might as well be a person's handle doesn't pass — this check isn't 100%,
and the way it stays safe is by refusing anything that isn't clear-cut.

### 1c. Automation candidate — title, body, and branch signals

With the author gate passed, any of these makes the PR a candidate:

- **The literal marker** in the body of custom auto-generated PRs
  (version bump, OTel deploy, workflow recompile, and likely others
  sharing the convention):

  ```
  (this PR is automatically generated)
  ```

  These show up authored by the repo owner's own account, one commit, a
  small/single-file diff, and a branch name shaped `{short-name}/{base}`
  — e.g. `versionbump/main`, `deploy-otel/main`, `recompile-aw/main`.

- **Self-hosted Renovate**, also authored under the owner's own account
  (running via `renovatebot/github-action` with a PAT, not the hosted
  Renovate GitHub App), recognizable by any of:
  - Body contains `renovate` case-insensitively alongside a footer like
    *"This PR has been generated by [Mend Renovate](...)"* or *"...[Mend
    Renovate CLI](...)"* — wording has varied between instances seen, so
    match loosely rather than on one exact string.
  - The PR's branch name starts with `renovate/`.
  - The underlying commit author (not the PR author) is `Renovate Bot`,
    email on the `whitesourcesoftware.com` domain.

- **Hosted dependency-update bots** — the classic case, an author account
  flagged as a bot rather than a regular user, with a login like
  `renovate[bot]` or `dependabot[bot]`. Seen historically on these repos
  (2024) even though the more recent pattern uses a PAT instead; some
  repos or orgs may still use the hosted app, so keep this check too.

- **Backports.** The base branch is a release or maintenance branch
  rather than the default branch, and the body names the commit being
  carried over — the autobackport workflow seen on these repos writes
  *"Automated backport of commit {sha}"* and reuses that commit's title
  as the PR title.

- **Titles** of the mechanical kind: "Automatic Version Bump", "Bump
  version from X to Y", "Deploy OpenTelemetry", "Recompile Agentic
  Workflows", "Update dependency X to vY", `chore(deps): ...`.

Titles are hand-editable, so **never** decide on a title alone — treat it
as one candidate signal among the others.

### Phase 1 outcome

- Coding agent matched → return `coding-agent`. **Done.**
- Author gate failed → return `human`. **Done.**
- No automation signal at all → return `human`. **Done.**
- Any automation candidate signal → **go to Phase 2. Mandatory.**

Renovate's own PR body spells out why a rebase ask would be redundant: it
states its rebase behavior explicitly (something like *"Rebasing:
Whenever PR is behind base branch, or you tick the rebase/retry
checkbox"*) — it already keeps itself current. Useful for the caller, but
it does not substitute for the later phases.

## Phase 2 — diff verification (mandatory for every automation candidate)

Fetch the changed files of the pinned head commit, and the diff content
itself where it's small enough to read. A PR may only be labelled
`automation` if the change has one of the shapes below.

For every shape except backports, that means an automation *shape*:
mechanical, repeatable, containing no human design decision —
re-running the tool would produce the same diff.

1. **Dependency version bumps or pins** (the Renovate case). Manifests
   and lockfiles: `package.json` + `package-lock.json`, `yarn.lock`,
   `requirements.txt`, `pyproject.toml` / `poetry.lock`, `go.mod` /
   `go.sum`, `Cargo.toml` / `Cargo.lock`, `Gemfile.lock`, `pom.xml`,
   Dockerfile base image tags, pinned digests, `uses:` action refs in
   `.github/workflows`, pre-commit config. Signature: only version
   strings or digests change.

2. **Lock file maintenance.** A lock file regenerated without any
   manifest change — Renovate's "lock file maintenance" and the like.
   Signature: only lock files change, and only in resolved versions,
   hashes or integrity fields.

3. **Version bump of the package itself.** Not a dependency, but the
   project's own version number moving forward — a plain `VERSION` file,
   `debian/control` (and a generated `debian/changelog` entry),
   `version` in `package.json`, `pyproject.toml` or `setup.py`, the
   package version in `Cargo.toml` or another `*.toml`, a Helm
   `Chart.yaml`, a `__version__` constant. Signature: a single version
   literal advanced, optionally with a generated changelog entry.

4. **Deployment of OpenTelemetry into GitHub Actions.** The diff adds or
   updates workflow steps referencing `plengauer/Thoth` or one of its
   aliases — the repo is also reachable as
   `plengauer/opentelemetry-github`, `plengauer/opentelemetry-shell`, and
   `plengauer/opentelemetry-bash`, and all of these appear in the wild
   because GitHub redirects renamed repos. Typical refs are
   `.../actions/instrument/job@vN`, `.../actions/instrument/workflow@vN`,
   and `.../actions/instrument/deploy@vN`. Changes confined to
   `.github/workflows`.

5. **Purely generated files.** Every changed file is one whose source of
   truth lives elsewhere and which a tool regenerates: compiled agentic
   workflows (`*.lock.yml`), lock files, generated test or demo JSON,
   workflows generated from templates, bundled or minified `dist` output,
   generated API clients, protobuf or OpenAPI stubs, generated docs,
   regenerated sample telemetry, recorded fixtures, snapshot or golden
   test files, generated screenshots. Signature: nothing hand-written
   moved — often the files carry a "generated, do not edit" header or
   live under a demos / samples / fixtures / snapshots / testdata path.

6. **Backports — the exception to the "mechanical" test.** The change
   itself is *not* something an automation would author: it's whatever
   a human or agent originally wrote. What makes it automation is the
   carrying-over, not the content. So the shape is: the base branch is an
   older release branch, and an **equivalent change already exists on
   the default branch** — identical, or a clean subset adapted to the
   older code. Verify by actually locating that commit or PR on the
   default branch (the backport body usually names the SHA); do not
   infer equivalence from the title. The disqualifiers below about
   production logic and behavior **do not apply** to backports, because
   the content was already reviewed and merged on the default branch —
   but anything in the diff that has *no* counterpart on the default
   branch does disqualify it.

7. **Anything else that, with reasonable confidence, looks like
   automation.** The shapes above are examples, not a whitelist. The
   test is the character of the change, not membership in this list:
   mechanical, repeatable, no design decisions, reproducible by
   re-running some tool. A PR that only passes here still has to clear
   Phase 3 like every other.

**Disqualifiers** (all shapes except backports — see 6). A diff that
touches production logic, changes or adds behavior, or mixes a mechanical
bump with unrelated hand-written edits is not automation — regardless of
how convincing the metadata was. Trust the diff over the metadata, return
`human`, and note the mismatch: a human-authored PR wearing an
automation-shaped title is exactly the case this phase exists to catch.

## Phase 3 — workflow provenance (mandatory for every automation candidate)

A diff that *looks* automated isn't enough; a workflow in the repo has to
be the plausible source of it. Three things, all required:

1. **A workflow exists that would do this.** Find the workflow in the
   repo whose job matches the Phase 2 shape — a Renovate workflow for
   dependency bumps and lock file maintenance, a version-bump workflow
   for the project's own version, a deploy-OTel workflow for the OTel
   shape, a recompile workflow for `*.lock.yml`, a backport workflow
   that takes commits from the default branch and applies them to
   older release branches for backports. Look at workflow names and at
   what they use or run (e.g. `renovatebot/github-action`, an action
   that deploys OpenTelemetry, a step that opens PRs against release
   branches). For a PR from a hosted bot app (`renovate[bot]`,
   `dependabot[bot]`), the app's configuration in the repo
   (`renovate.json`, `.github/dependabot.yml`) stands in for the
   workflow, and step 2 doesn't apply — there are no runs to find.

2. **A run of it lines up with this PR.** Cross-reference the pinned head
   commit (and the PR's creation) with that workflow's runs:
   - Best: the run's logs mention this PR — its number, its branch, or
     the head commit's SHA.
   - Good enough: the logs say nothing useful (or have expired), but a
     run of that workflow was in progress at, or finished shortly after,
     the time the head commit was pushed or the PR was created.
   Prefer the push time of the head commit over its commit date where
   both are available — Renovate and similar tools rebase and re-push,
   so the head can be much newer than the PR.

3. **The workflow's code plausibly produces this diff.** Read the
   workflow and confirm that what it *intends* to do would, in theory,
   result in a change like this one. This is a sanity read, not a proof:
   - Don't tabletop it — don't reconstruct the run step by step or try
     to reproduce the exact diff.
   - Don't mind bugs in the workflow — whether it works correctly is not
     the question, only whether this is the kind of output it's for.
   - The bar is: "there's a Renovate action in a workflow called
     something like renovate, it ran when this commit was pushed, and
     the change is version bumps and pins — good enough." Or: "there's a
     deploy-OTel workflow, it uses an action that deploys OpenTelemetry,
     and the diff deploys OpenTelemetry — good enough."

If any of the three fails — no matching workflow, no run anywhere near
the right time, or a workflow whose purpose doesn't fit the diff —
**return `human`** and note which part failed.

## Ordinary human PR

Anything that matched no signal in Phase 1 or failed its author gate, and
anything that reached Phase 2 or 3 but failed it.

## If a PR doesn't clearly match any bucket

Don't guess. Return `human` (the same answer as an ordinary human PR) —
the calling skill's own judgment about what "not automation" means for
its purpose (safe default vs. requires caution) is its call to make, not
this skill's. Note the ambiguous case so the pattern can be added here if
it turns out to be a new automation category — this file is meant to grow
from confirmed real examples, not speculation. That applies to every
phase: a new bot-shaped login belongs in 1b, a new mechanical diff shape
belongs in Phase 2, a new kind of producing workflow belongs in Phase 3.

## Output

When consulted, report back per PR:

- `automation` — say which Phase 1 signal flagged it, which Phase 2 shape
  confirmed it, **and** which workflow (and run, or time-window match)
  confirmed it in Phase 3, plus the **head commit SHA** that was
  classified. A label missing any of these is not a valid answer.
- `coding-agent` — specify Copilot, Claude, or Codex.
- `human` — includes anything ambiguous, unmatched, failing the author
  gate, or metadata-flagged but disqualified in Phase 2 or 3. Say which
  check it stopped at.

Calling skills use this label directly in their own task logic and
reporting.
