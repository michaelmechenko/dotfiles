---
name: tldr
description: "Ultra-short 'where was I' orientation for the current project: what you're working on, the repos/worktrees in play, and PR state (open, pushed-no-PR, or unpushed). Use when returning to a session and needing a quick catch-up, when asked to orient, catch me up, or remind me what I'm doing."
allowed-tools: bash read grep find
---

# TL;DR — session orientation

A terse, read-only "where was I" for the current project. Prefer already-summarized sources over
re-deriving from scratch. Do **not** modify anything.

## Sources

1. **Canonicalize to the main repo**, so a worktree resolves to the shared todos:
   ```bash
   root=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
   cdir=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
   case "$cdir" in */.git) main=$(dirname "$cdir") ;; *) main="$root" ;; esac
   ```
2. **What you're doing**:
   - If a pi goal is active, call `get_goal` for its objective/state first — cheapest source.
   - Otherwise fall back to recent `git log --oneline -5` + working-tree state and say there's
     no session context to draw on.
3. **Repos / worktrees in play** — `git -C "$main" worktree list` (each worktree + its branch);
   note the current branch (`git branch --show-current`) and current worktree if inside one.
4. **PR state** per relevant branch:
   - **Open PRs** (already pushed): `gh pr list --author @me --state open` (add `--head <branch>`
     to check a specific branch). Show number + title + branch.
   - **Pushed, no PR / unpushed**: `git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads`
     and/or `git log @{u}.. --oneline` per branch → branches with local commits not on remote and
     no open PR ("still needs a PR / push").

## Output (keep it tiny — a glance, not a report)

```
project: <name> (<main>)   branch: <branch>   worktree: <name|—>
doing:   <ctx / goal one-liner>
worktrees: <name (branch)>, <name (branch)> …   (omit line if only main)
prs:     #<n> <title> (<branch>)  ·  <branch>: N unpushed, no PR  ·  <branch>: pushed, no PR
```

- One line per section; drop any section with nothing to show.
- Lead with `doing:` — that is the thing the user forgot.
- If `gh` isn't authenticated or the repo has no remote, skip `prs:` and say so in one clause.

## Guidelines

- Read-only. Never write files, commit, push, or open PRs.
- Fast: prefer already-summarized sources over transcript parsing; cap git/gh calls.
- Terse over complete — this is a reminder, not a full session review.
