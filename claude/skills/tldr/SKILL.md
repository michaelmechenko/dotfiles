---
name: tldr
description: "Ultra-short 'where was I' orientation for the current project: what you're working on, the repos/worktrees in play, outstanding todos, and PR state (open, pushed-no-PR, or unpushed). Use when returning to a session and needing a quick catch-up, when asked to orient, catch me up, or remind me what I'm doing."
allowed-tools: Bash, Read, Grep, Glob
---

# TL;DR — session orientation

A terse, read-only "where was I" for the current project. Prefer the session map (cheap, already
summarized) over re-deriving from transcripts. Do **not** modify anything.

## Sources

1. **Canonicalize to the main repo** (same logic as `/smap-update`), so a worktree resolves to the
   shared log/todos:
   ```bash
   root=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
   cdir=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
   case "$cdir" in */.git) main=$(dirname "$cdir") ;; *) main="$root" ;; esac
   case "$main" in *"/.claude/worktrees/"*) main="${main%%/.claude/worktrees/*}" ;; esac
   tmp="${main//\//-}"; slug="${tmp//./-}"
   log=~/.config/smap/"$slug".md
   ```
2. **What you're doing** — from `$log`: the newest session block's `ctx:` (or Goal) + its Open
   items, plus `$main/SMAP-TODOS.md` open todos. If no smap exists, fall back to recent
   `git log --oneline -5` + working-tree state and say the map is empty.
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
todo:    <top 2–3 open items>
prs:     #<n> <title> (<branch>)  ·  <branch>: N unpushed, no PR  ·  <branch>: pushed, no PR
```

- One line per section; drop any section with nothing to show.
- Lead with `doing:` — that is the thing the user forgot.
- If `gh` isn't authenticated or the repo has no remote, skip `prs:` and say so in one clause.

## Guidelines

- Read-only. Never write files, commit, push, or open PRs.
- Fast: prefer the smap over transcript parsing; cap git/gh calls.
- Terse over complete — this is a reminder, not `/smap-read` (use that for the full picture).
