---
name: github-pr-volatile-failure-detection
description: >
  Classify a failed GitHub Actions job's log as volatile (worth a rerun —
  rate limits, registry flakiness, transient 5xx, cancelled runner) or
  real (a genuine bug — leave it failing) — and return that
  classification for another skill or task to act on. This skill does
  not take any action itself, and it does not decide which checks
  failed or trigger any rerun; it only reads a given job's log and
  judges the one failure. Use whenever a task needs to know "would
  rerunning this failed job, unchanged, plausibly pass?" for a specific
  CI log.
---

# GitHub PR Volatile Failure Detection

A classifier, not an action. Given a failed CI job's log, decide whether
it falls into **volatile** (a rerun would plausibly pass), **real** (a
rerun changes nothing — leave it failing), or **unclear** (doesn't
confidently match either), and hand that back. Fetching the log, finding
which checks failed in the first place, and triggering the actual rerun
are all out of scope here — that's the calling skill's job.

The question to ask is always "would rerunning this, unchanged,
plausibly pass?" — not "is this annoying" or "is this expensive to fix."

## Reading the log efficiently

GitHub Actions logs are timestamped and can run long before the actual
failure — a single job can have hundreds of lines of package-manager or
build noise ahead of the real error. GitHub marks the actual failure
line(s) with `##[error]` itself; search for that marker and read the
lines immediately around it rather than starting from the top. The step
name and exit code shown right before/after the marker usually says
exactly what failed.

## Likely volatile — rerun

- HTTP 502 / 503 / 504 from any external dependency (and a bare 500 too,
  as long as it's clearly the *dependency's* server, not an assertion in
  the code under test).
- HTTP 429 / "rate limit exceeded" — package registries, Docker Hub,
  GHCR, or the GitHub API itself mid-workflow.
- TLS/SSL handshake failures, "connection reset by peer", "could not
  resolve host" and other DNS failures, generic connection timeouts.
- "The operation was canceled" or "runner has received a shutdown
  signal" when tied to infrastructure (a runner dying mid-job), not a
  human clicking cancel.
- Registry/mirror flakiness during `apt-get`, `pip install`, `npm
  install`, `gradle`, Docker pulls — timeouts or transient 5xx during the
  fetch step specifically, not a real dependency-resolution conflict.
- Any transient GitHub API 5xx surfacing inside the workflow's own steps
  (as opposed to the check-runs API the calling skill itself is using).

## Likely NOT volatile — leave failing, report it

- Test assertion failures, compile errors, syntax errors, type errors,
  lint failures — a rerun changes nothing about the code.
- "command not found" or a non-zero exit from a real script bug.
- 401/403 that isn't obviously rate-limit related — see the PAT-rotation
  note below before assuming this one's safe to ignore.
- A comparison between two values that legitimately differ (a version
  check, a hash check, a count) — this usually means something upstream
  changed, not that the runner had a bad day.

## Auth failures near a token rotation boundary

If the repo's automation uses a PAT on a rotation cycle, a 401/403 that
starts right around a rotation boundary is worth calling out specifically
as *"possibly an expired/rotated token"* rather than classifying it
volatile — a rerun won't fix an expired token, and this is an easy thing
to mis-file as "just flaky."

## When it doesn't clearly match either list

Return "unclear" instead of guessing either way. A wrong rerun costs real
CI minutes and delays finding the actual problem; an unnecessary "not
sure" result costs a few seconds of a human's reading time. Bias toward
"unclear."

One real example worth keeping in mind for the shape these can take: a
package's freshly-installed version came back *ahead of* what the
repo's `/releases/latest` API reported (installed 5.59.0, latest
reported 5.58.1) — plausibly a release-publish race rather than a "true"
bug, but not a clean HTTP-error case either. Exactly the kind of thing to
return "unclear" on rather than silently picking a side.

## Output

When consulted for a specific failed job's log, report back one of:
`volatile` (with the matched pattern, e.g. "HTTP 503 from registry"),
`real` (with the matched pattern, e.g. "test assertion failure"), or
`unclear` (with a one-line description of the failure so the calling
skill can surface it as "failed, cause unclear"). Calling skills use this
label directly in their own task logic and reporting — this skill never
decides on its own whether to rerun anything.
