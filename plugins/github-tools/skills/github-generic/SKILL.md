---
name: github-generic
description: >
  General-purpose GitHub skill. Use this whenever the user asks to do anything
  with GitHub — reading or creating issues, PRs, comments, reviews, branches,
  releases, files, repos, gists, Actions workflows, labels, milestones, team
  memberships, org settings, code search, notifications, or any other GitHub
  operation. Trigger even for vague phrasing like "check my GitHub", "push
  this", "open a PR", "look at my issues", "check CI status", or anything that
  implies interacting with github.com. Prefer this skill over ad-hoc tool use
  so the correct escalation ladder is always followed.
---

# GitHub Generic Skill

This skill governs **how** to interact with GitHub. It defines a strict tool
priority ladder and tells you how to escalate when a lower tier cannot complete
an operation.

---

## Tool Priority Ladder

Always attempt operations in this order. Move to the next tier only when the
current one fails (see escalation criteria below).

```
Tier 1 ── GitHub MCP              (GitHub:* tools)
    ↓  [escalate if needed]
Tier 2 ── GitHub REST API MCP     (GitHub REST API:* tools)
    ↓  [escalate if needed]
Tier 3 ── GitHub GraphQL API MCP  (GitHub GraphQL API:* tools)
    ↓  [escalate if needed]
Tier 4 ── GitHub CLI MCP (gh)     (GitHub CLI:* tools)
    ↓  [escalate if needed]
Tier 5 ── Chrome (remote control) (Claude in Chrome:* tools)
    ↓  [escalate if needed]
Tier 6 ── Computer control        (computer:* tools)
```

Never skip tiers proactively. If a higher tier can do the job, use it — even
if a lower tier would be more convenient or more powerful.

---

## Tool Unavailability Retry Policy

Before escalating to the next tier, if a tier's tools are **missing or
unavailable** (i.e. `tool_search` returns no results for that tier, or a
specific tool you expect to exist is absent), apply this retry sequence:

| Attempt | Wait before retrying |
|---|---|
| 1st retry | 10 seconds |
| 2nd retry | 30 seconds |
| 3rd retry | 60 seconds |

After each wait, re-run `tool_search` (or attempt to invoke the tool again)
to check whether it has become available. If the tool is still unavailable
after all 3 retries, then escalate to the next tier.

**This retry policy applies only to tool unavailability.** Do **not** use it
for errors that a tool itself returns (e.g. HTTP 403, 404, 422, 429, 5xx) —
those are handled by the escalation criteria below.

---

## Tier Descriptions

### Tier 1 — GitHub MCP (`GitHub:*`)

The **primary and preferred** tier for all GitHub operations. Check whether
`GitHub:*` tools are available before starting any task.

**Common tools**: `GitHub:get_me`, `GitHub:list_issues`, `GitHub:issue_read`,
`GitHub:issue_write`, `GitHub:list_pull_requests`, `GitHub:pull_request_read`,
`GitHub:create_pull_request`, `GitHub:get_file_contents`, `GitHub:push_files`,
`GitHub:create_branch`, `GitHub:search_repositories`, `GitHub:search_issues`,
`GitHub:search_code`, `GitHub:search_pull_requests`, `GitHub:add_issue_comment`,
`GitHub:merge_pull_request`, `GitHub:get_commit`, `GitHub:list_commits`, and
many others.

Use `tool_search` with a relevant query if you are unsure whether a tool exists.

### Tier 2 — GitHub REST API MCP (`GitHub REST API:*`)

A much larger surface area than Tier 1. Use when Tier 1 cannot perform the
operation or has hit an escalation trigger. Covers virtually every public
GitHub REST endpoint.

**Examples of things only Tier 2 can do**: fine-grained Actions controls,
Dependabot secrets, Pages configuration, repo rulesets, webhook management,
rate-limit introspection, and many admin/org endpoints not exposed in Tier 1.

There are over 1,000 tools in this tier — use `tool_search` to find the right
one rather than guessing.

### Tier 3 — GitHub GraphQL API MCP (`GitHub GraphQL API:*`)

Use when Tier 2 also fails or is blocked. GraphQL is useful for:
- Operations requiring deeply nested, multi-resource queries in one round-trip
- Mutations not available in REST (e.g. resolving review threads, project v2
  item mutations, certain discussion operations)

### Tier 4 — GitHub CLI MCP (`GitHub CLI:*`)

Use when Tiers 1–3 all fail or are blocked. This tier wraps the `gh` CLI
itself (authenticated via the same GitHub token as the other tiers), so it's
useful for anything that specifically requires `gh`'s own behavior rather
than a raw API call — e.g. operations `gh` composes from multiple API calls
internally, or `gh`-specific conveniences that don't have a direct REST/GraphQL
equivalent.

**Note:** this tier's tool names are provisional. They'll be finalized once
the actual `gh`-based MCP server command is wired into this plugin's
`.mcp.json` — update this section's tool prefix if that name changes.

### Tier 5 — Chrome (remote control)

Use `Claude in Chrome:*` tools to drive a real browser session when all API
tiers have failed or are unavailable.

**Rules for Tier 5**:
- First verify Chrome is connected (`Claude in Chrome:list_connected_browsers`).
  If Chrome is not connected, escalate to Tier 6.
- **Open a new tab** at the start of any Tier 5 operation. **Close that tab**
  when the operation is complete, leaving the browser in the state it was in
  before.
- Navigate to `https://github.com` and confirm the user is already logged in
  before doing anything else. Do **not** attempt to log in on their behalf.
- Prefer navigating directly to deep-link URLs over clicking through menus.
- Only perform the specific action requested — do not click around exploratorily.
- If a CAPTCHA or 2FA prompt appears, stop and ask the user to handle it.

Read `references/chrome-fallback.md` for detailed step-by-step guidance.

### Tier 6 — Computer control (`computer:*`)

**Last resort.** Use computer-control tools to open Chrome manually and interact
with GitHub via clicks and keyboard input when all other tiers are unavailable.

**Rules for Tier 6**:
- First verify computer-control tools are available. If they are not, tell the
  user you cannot complete the action automatically and give them clear manual
  instructions instead.
- Open a new Chrome window or tab, navigate to `https://github.com`, and confirm
  the user is already logged in before doing anything else.
- **Close the tab or window** you opened when the operation is complete.
- Interact only via the specific clicks and keystrokes needed for the task.
- If a CAPTCHA, 2FA prompt, or any unexpected dialog appears, stop and ask the
  user to handle it in the browser, then signal you to continue.
- After every mutation, confirm the expected outcome is visible on screen before
  reporting success.

---

## Escalation Criteria

Move from the current tier to the next when **any** of the following occur:

| Trigger | Example |
|---|---|
| **Tool not found** | No `GitHub:*` tool exists for the needed action |
| **Permission denied / 403** | Authenticated but lacks scope or org access |
| **404 on a resource that should exist** | Repo exists but MCP cannot see it |
| **422 / Unprocessable** after a correct request | Validation error that cannot be fixed |
| **Rate-limited (429)** with no retry path | Quota exhausted, cannot wait |
| **Persistent 5xx errors** | Server error on repeated attempts |
| **Feature gap confirmed** | Tool exists but explicitly lacks the capability |
| **Tier not connected / unavailable** | Chrome not connected, computer tools absent, `gh` not installed (native or WSL) |

**Do not escalate** for:
- Transient network errors (retry once or twice first)
- User input errors (ask for clarification instead)
- 404s on resources the user may have misnamed (confirm the name first)

When escalating, tell the user which tier you are moving to and briefly why.
Example: *"The GitHub MCP doesn't expose webhook management, so I'll use the
GitHub REST API MCP instead."*

---

## General Operating Rules

1. **Discover before acting.** When the user's intent is ambiguous (e.g. "fix
   my PR"), use read-only tools to understand the current state before making
   any mutations.

2. **Confirm destructive actions.** Before deleting, force-pushing, closing, or
   merging anything, state what you are about to do and ask for confirmation —
   unless the user has already given explicit, unambiguous approval in the same
   message.

3. **Resolve identity once.** If you need the authenticated user's login, call
   `GitHub:get_me` (or the Tier 2 equivalent) once and reuse the result.

4. **Paginate proactively.** Most list tools return partial results. Keep
   fetching pages until you have all the data you need, or until you have
   enough to answer the user's question. Whenever you list something, go
   through **all** pages, not just the first. This is non-negotiable when an
   operation needs to act on **pull requests, issues, workflow runs, or
   workflow jobs** — e.g. bulk maintenance, triage, or "go through all my
   PRs" style tasks. Missing later pages there means silently skipping items
   the user asked you to handle. Only stop paginating early if you're
   answering a narrow read-only question where the first page already fully
   answers it (e.g. "what's my most recent PR").

5. **Cite sources.** When reporting information (issue titles, PR statuses,
   file contents), include direct GitHub URLs so the user can verify.

6. **Stay on task.** Do not read files, navigate repos, or call tools beyond
   what is needed for the current operation.

7. **Report failures clearly.** If all tiers fail for an operation, tell the
   user exactly what was tried, what failed, and what they can do manually.

8. **Disclose generated content.** Any text you generate and post to
   GitHub — issue bodies, issue comments, PR bodies, PR/review comments,
   formal reviews, and similar — must end with a short marker on its own
   line disclosing it was generated by Claude:

   ```
   (🤖 generated by Claude)
   ```

   This applies to everything you write and post, not just the longer
   drafted instructions — including short thread-resolution replies.
   The one exception: **never** add this marker to issue or pull request
   **titles**.

9. **Preserve file permissions/mode when touching files.** When creating,
   updating, or overwriting a file through a GitHub tool (any tier), make
   sure the operation does not silently change the file's permissions —
   most commonly, dropping the executable bit on scripts. Some tools/APIs
   (e.g. content-update endpoints that default to mode `100644`) do this
   even when you didn't intend to change permissions. Before you write:
   check the existing file's mode (e.g. via `GitHub:get_file_contents` /
   the Git Trees API, which reports blob mode as `100644` regular or
   `100755` executable). After you write, verify the resulting mode still
   matches. If a tool dropped it, repair it — e.g. by writing the file via
   the Git Data API (create a tree entry with the correct `mode`) rather
   than a content-update endpoint that doesn't let you set mode. Flag it to
   the user if you had to repair a permission regression.

---

## Quick-Reference: Which Tier for Common Tasks?

| Task | Likely starting tier |
|---|---|
| Read issues / PRs / comments | Tier 1 |
| Create/update issues, PR comments | Tier 1 |
| Search code, issues, repos | Tier 1 |
| Push files / create branches | Tier 1 |
| Merge a PR | Tier 1 |
| Manage GitHub Actions (secrets, vars, runners) | Tier 2 |
| Manage webhooks | Tier 2 |
| Manage Dependabot alerts/secrets | Tier 2 |
| Configure Pages, rulesets, environments | Tier 2 |
| Resolve PR review threads | Tier 3, then Tier 5 |
| GitHub Projects v2 mutations | Tier 3 |
| Anything requiring a logged-in browser click | Tier 5, then Tier 6 |

---

## Reference Files

- `references/chrome-fallback.md` — Detailed instructions for Tier 5 browser
  automation. Read this before using any `Claude in Chrome:*` tools.
