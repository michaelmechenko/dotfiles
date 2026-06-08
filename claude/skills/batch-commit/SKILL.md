---
name: batch-commit
description: "Split work into logical, well-scoped commits and group those commits into reviewable PR-sized batches, using clear Conventional Commits messages. Never pushes. Use when the user asks to commit, craft a commit message, stage changes, split work into multiple commits, or batch commits for separate PRs."
---

# Batch Commit

## Goal

Make commits that are easy to review and safe to ship, grouped into PR-sized batches:

- only intended changes are included
- commits are logically scoped (split when needed)
- related commits are grouped into reviewable batches (one batch ≈ one PR)
- commit messages describe what changed and why

**Never push and never open PRs.** This skill stops at local commits. Pushing and PR creation
are always a separate, explicit user action. 

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
   - Do not use emojis

7. **Run the smallest relevant verification**
   - Run the repo's fastest meaningful check (unit tests, lint, or build)

8. **Repeat** for the next commit until the working tree is clean

9. **Group commits into PR-sized batches**
   - After committing, partition the new commits into batches that each map cleanly to one PR
   - Batch by: independent feature, refactor vs behavior change, area of codebase, or anything a
     reviewer would want to evaluate separately
   - Each batch should be independently reviewable and ideally independently revertable
   - Report the batches: which commits belong to which prospective PR, and a one-line rationale
   - **Stop here.** Do not push, do not create branches for the batches, do not open PRs.
     Hand off to the user (or `/pr-create`) for anything beyond local commits.

## Deliverable

- the final commit message(s)
- a short summary per commit (what/why)
- the commands used to stage/review
- the proposed PR-sized batches (commit groupings + rationale), with no push/PR performed
