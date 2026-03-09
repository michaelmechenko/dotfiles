---
name: diff-summary
description: "Show working tree changes or diff between branches. Use when asked to summarize changes, compare branches, or review what's uncommitted."
argument-hint: "[source-branch] [target-branch]"
---

# Diff Summary

## Usage

- No arguments: show uncommitted changes (staged + unstaged + untracked)
- One argument ($1): compare that branch to HEAD
- Two arguments ($1, $2): compare $1 to $2

## Workflow

### No arguments (uncommitted changes)

```bash
git status --porcelain
git diff --cached --stat && git diff --cached
git diff --stat && git diff
git ls-files --others --exclude-standard
```

### Branch comparison ($1 source, $2 target or HEAD)

```bash
git fetch --all --prune 2>/dev/null || true
git diff --stat "$TARGET"..."$SOURCE"
git log --oneline --no-merges "$TARGET".."$SOURCE"
git diff --name-only "$TARGET"..."$SOURCE"
git diff "$TARGET"..."$SOURCE"
```

## Output

Provide a concise summary of:
- Stats overview (files changed, insertions, deletions)
- Commits included (if branch comparison)
- Files changed
- Full diff details
