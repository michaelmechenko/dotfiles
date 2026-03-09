---
name: commit-work
description: "Create high-quality git commits: review/stage intended changes, split into logical commits, and write clear Conventional Commits messages. Use when the user asks to commit, craft a commit message, stage changes, or split work into multiple commits."
---

# Commit Work

## Goal

Make commits that are easy to review and safe to ship:
- only intended changes are included
- commits are logically scoped (split when needed)
- commit messages describe what changed and why

## Inputs to ask for (if missing)

- Single commit or multiple commits? (Default: multiple small commits for unrelated changes)
- Commit style: Conventional Commits required
- Any rules: max subject length, required scopes

## Workflow

1. **Inspect the working tree before staging**
   - `git status`
   - `git diff` (unstaged)
   - If many changes: `git diff --stat`

2. **Decide commit boundaries (split if needed)**
   - Split by: feature vs refactor, backend vs frontend, formatting vs logic, tests vs prod code, dependency bumps vs behavior changes
   - If changes are mixed in one file, plan to use patch staging

3. **Stage only what belongs in the next commit**
   - Prefer patch staging for mixed changes: `git add -p`
   - To unstage: `git restore --staged -p` or `git restore --staged <path>`

4. **Review what will actually be committed**
   - `git diff --cached`
   - Sanity checks: no secrets or tokens, no accidental debug logging, no unrelated formatting churn

5. **Describe the staged change in 1-2 sentences (before writing the message)**
   - "What changed?" + "Why?"
   - If you cannot describe it cleanly, the commit is probably too big; go back to step 2

6. **Write the commit message**
   - Use Conventional Commits: `type(scope): short summary`
   - Blank line, body (what/why), footer (BREAKING CHANGE) if needed
   - See `references/commit-message-template.md` if helpful

7. **Run the smallest relevant verification**
   - Run the repo's fastest meaningful check (unit tests, lint, or build)

8. **Repeat** for the next commit until the working tree is clean

## Deliverable

- the final commit message(s)
- a short summary per commit (what/why)
- the commands used to stage/review
