---
name: pr-create
description: "Create pull requests with proper branch management, staging, and GitHub CLI integration. Use this skill whenever the user wants to create a PR, open a pull request, push changes for review, get code merged, or mentions 'PR', 'pull request', 'push and create', or 'ready for review'. Also use when the user has finished work and wants to share it with their team."
---

# PR Create

Create pull requests end-to-end: branch creation, staging, committing, pushing, and PR creation via `gh` CLI.

## Workflow

### 1. Assess Current State

Run these in parallel to understand what you're working with:

```
git status
git branch --show-current
git log --oneline -5
git diff --stat
git diff --cached --stat
```

Determine:
- Are there uncommitted changes that need staging?
- Is this the right branch, or do we need to create one?
- Is the branch already pushed to remote?
- What's the base branch (usually `main` or `master`)?

### 2. Branch Management

If on `main`/`master` with uncommitted changes, create a feature branch first:
- Derive branch name from the work: `feat/description`, `fix/description`, `chore/description`
- Use kebab-case, keep it short (under 50 chars)
- `git checkout -b <branch-name>`

If already on a feature branch, stay on it.

### 3. Stage and Commit

If there are unstaged changes:
- Review the diff to understand what changed
- Stage specific files (prefer `git add <file>` over `git add .`)
- Never stage `.env`, credentials, or large binaries
- Write a Conventional Commits message: `type(scope): description`
- If changes span multiple concerns, split into multiple commits

If changes are already committed, skip to push.

### 4. Push

```
git push -u origin <branch-name>
```

If the branch already tracks remote and is behind, check if force-push is needed. Never force-push without confirming with the user.

### 5. Create PR

Use `gh pr create` with a well-structured body:

```bash
gh pr create --title "<concise title under 70 chars>" --body "$(cat <<'EOF'
## Summary
<1-3 bullet points explaining what changed and why>

## Changes
<bullet list of specific changes>

## Test plan
- [ ] <verification steps>

EOF
)"
```

Additional flags to consider:
- `--reviewer <username>` if the user specifies reviewers
- `--label <label>` if labels are requested
- `--draft` if the work is still in progress
- `--base <branch>` if targeting something other than the default branch

### 6. Report

After creation, output:
- PR URL
- Branch name
- Number of commits included
- Files changed summary

## Edge Cases

- **Multiple commits on branch**: Include all in the PR, summarize the full diff against base
- **Merge conflicts**: Warn the user and suggest resolution approach, don't auto-resolve
- **Existing PR for branch**: Use `gh pr view` to check first; if one exists, suggest updating it instead
- **No changes**: If working tree is clean and branch matches remote, tell the user there's nothing to PR
- **Draft PRs**: If the user says "not ready yet" or "WIP", use `--draft`

## Communication

- Show the PR URL prominently when done
- If anything is ambiguous (target branch, reviewers, draft vs ready), ask before creating
- Never force-push or rebase without explicit user consent
