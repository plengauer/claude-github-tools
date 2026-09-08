---
name: github-secret-upload
description: >
  Upload or rotate a GitHub Actions secret on a repository, either
  repository-wide or in one or more named environments, then verify it
  actually landed. Takes a repository, an optional list of environments,
  a secret key and a secret value. Use whenever the user asks to "add a
  secret", "set a secret", "rotate a token/credential in a repo",
  "update GITHUB_X in prod and staging", "put this API key in the repo
  secrets", or anything that implies writing a value into a repo's
  Actions secrets — including as one step of a larger setup or rotation
  task.
compatibility: >
  Needs a way to read the target's public key, write an Actions secret
  at repository or environment level, and list secret metadata to
  confirm the write. GitHub's REST API covers all three. If the write
  goes through a raw API, a sealed-box (libsodium `crypto_box_seal`)
  implementation is required — see "Encrypting the value" below.
---

# GitHub Secret Upload

Puts one secret value where CI can read it, and proves it got there.

This skill describes *what* to do, not which specific tool call does
it — use whatever the session offers, following the usual escalation
ladder.

## Inputs

- **repository** — `owner/repo`.
- **environments** — zero or more environment names. Empty means the
  secret is repository-wide. Non-empty means the secret is written into
  each named environment *instead of* repository-wide, unless the user
  explicitly asks for both.
- **key** — the secret name. GitHub only accepts uppercase letters,
  digits and underscores, and rejects names starting with `GITHUB_` or
  a digit. Normalize an obviously-intended name (`my-key` →
  `MY_KEY`) and say so; stop and ask if the intent is unclear.
- **value** — the secret itself.

Confirm each environment exists before writing. A typo'd environment
name will otherwise be silently created or rejected depending on the
path taken, and the user ends up with a secret nobody reads.

## Handling the value

Treat the value as radioactive: never echo it, never write it to a
file, a scratch note, a commit, a comment, or a log line, and never
include it in the final report. If the user hasn't supplied it, ask
for it rather than inventing a placeholder.

Preserve it byte-for-byte. Trailing newlines are the classic failure
here — a value copied out of a terminal often carries one, and CI then
fails in a way that looks nothing like "your secret has a stray
newline". Strip surrounding whitespace only when the user's intent is
plainly a single-line token, and mention that you did.

## Encrypting the value

Some paths (a CLI, a browser) encrypt for you. If the write goes
through the API directly, GitHub never accepts a plaintext secret — you
must encrypt it yourself, and the details are easy to get subtly wrong:

1. **Fetch the public key of the exact target you're writing to.** A
   repository-wide secret uses the repository's public key; an
   environment secret uses *that environment's own* public key. They
   are different keys. Using the repo key for an environment secret is
   the single most common cause of a rejected or undecryptable secret,
   and writing to N environments means fetching N keys.
2. The response gives a base64-encoded Curve25519 public key plus a
   `key_id`. Base64-decode the key before using it.
3. **Seal the raw value with libsodium's sealed box** (`crypto_box_seal`
   — anonymous sender, ephemeral keypair, no signing key needed).
   Encrypt the raw bytes of the value, not a base64 or JSON-escaped
   rendering of it; pre-encoding produces a secret whose decrypted
   content is the encoding, which CI happily hands to your job as
   garbage.
4. Base64-encode the resulting ciphertext and send it together with the
   `key_id` you got in step 2. The `key_id` tells GitHub which key was
   used; omitting or mismatching it fails the write.

Creating and updating a secret are the same operation — writing an
existing name rotates it in place, so there's no need to delete first.

## Verifying

Secret values are write-only: nothing can read one back, so
verification is about metadata, not content. After writing, list the
secrets of each target you wrote to and confirm the name is present and
its `updated_at` (or `created_at` for a brand-new secret) timestamp is
from the write you just performed — not from an earlier run. A stale
timestamp with the right name means an earlier version of the secret is
still in place and your write didn't take.

Verify per target, matching the configuration:

- Repository-wide → check the repository's secret list.
- Environments → check each environment's secret list separately. All
  of them; a partial success where three of four environments got the
  new value is worse than a clean failure, because the broken one only
  surfaces at deploy time.

If verification fails for a target, retry that target once, then report
the failure plainly rather than reporting overall success.

## Report

A short plain summary — no tables:

- The repository, the secret name, and whether it went repository-wide
  or into environments (naming them).
- Per target: created vs. rotated, and whether verification passed.
- Anything you normalized (the key name, stripped whitespace).
- Any target that failed, and what the user should do about it.

Never include the value, any prefix or suffix of it, or its length.

## Things this skill does not do

Doesn't manage Dependabot, Codespaces, or organization-level secrets;
doesn't create or configure environments, protection rules, or
variables (non-secret configuration); doesn't delete secrets; doesn't
touch workflow files to consume the new secret. Doesn't rotate the
credential at the upstream provider — it only stores what it's given.
