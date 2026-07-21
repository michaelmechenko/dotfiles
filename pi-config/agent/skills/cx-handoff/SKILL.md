---
name: cx-handoff
description: "Generate a paste-ready handoff prompt for a separate session and copy it to the clipboard. Default is a general handoff; --review/-r writes a prompt for a review agent verifying a PR's changes; --continue/-c writes a full-context continuation prompt for a fresh/compacted session. Use when handing work to another session or agent, prepping a review, or before compacting a high-context session."
allowed-tools: bash read grep find
---

# cx-handoff — handoff prompt to clipboard

Produce a prompt that a *separate* session (or agent) can be started with, and copy it to the
clipboard via `pbcopy`. The output is the prompt itself — written in the second person, addressed
to the receiving session — not a summary for the current user.

## Modes (parse the user's request for a flag)

- **default** (no flag) — general handoff: hand the work to another session to keep going.
- **`--review` / `-r`** — a prompt for a **review agent** that needs context to verify a change
  (typically a PR): what changed and why, the files/areas touched, how to run/verify, and the
  specific functionality + edge cases to confirm. Include the PR URL if one exists
  (`gh pr view --json url,number,title` on the current branch), else the diff range.
- **`--continue` / `-c`** — a **continuation** prompt for a fresh (compacted) session that must
  resume from the exact current point: goal, decisions made + rationale, current state, the
  precise next step, open questions, and the key files. Assume the receiver has *no* memory of
  this session — carry everything load-bearing, omit what a model already knows.

## Gather context

Check for a cheap, already-summarized source before falling back to raw git/transcript digging:

- **A pi goal, if one is active** — call `get_goal` for its objective/state; it's cheaper than
  re-deriving the same ground from the conversation.

Then sample the working tree:

```bash
git status --porcelain
git diff --stat
git diff --cached --stat
git log --oneline -10
git branch --show-current
gh pr view --json url,number,title,state 2>/dev/null   # for --review, if a PR exists
```

Draw the substance from the live conversation (what was actually done/decided this session);
the git output is scaffolding for files/scope.

## Output shape (adapt per mode; keep tight, no emojis)

**default / `--continue`:**
```markdown
# Handoff: <title>

## Goal
<what we're ultimately trying to do>

## State
<what's done vs. in progress; current working-tree/branch state>

## Decisions & rationale        # emphasize in --continue
- <decision> — <why>

## Next step
1. <the precise next action>

## Key files
- `path` — <role>

## Open questions / gotchas
- <blocker or thing to watch>
```

**`--review` / `-r`:**
```markdown
# Review request: <title>

## What changed & why
<summary of the change and its intent>

## Where
- PR: <url>            # or: diff range `<base>...<branch>`
- files: `path`, `path`

## Verify
- [ ] <functional behavior to confirm>
- [ ] <edge case>
- how to run: <command / manual steps>
```

## Copy to clipboard

Build the prompt, then copy it verbatim (heredoc → `pbcopy`), and confirm the mode + title copied:

```bash
cat <<'EOF' | pbcopy
<the assembled prompt>
EOF
```

## Guidelines

- Read-only on the repo — never commit, push, or open PRs.
- The clipboard content is the prompt to paste into the *other* session; keep it self-contained.
- Second person, imperative, no fluff, no emojis (mirrors `../batch-commit/references/commit-conventions.md` tone).
