---
name: code-review
description: "Review code changes for quality, bugs, security, and best practices. Use when asked to review uncommitted changes, a specific commit, or a pull request."
allowed-tools: Read, Grep, Glob, WebFetch, WebSearch, Bash
argument-hint: "[PR number or guidance]"
---

# Code Review

Review code changes and correlate results into a summary ranked by severity.

## Workflow

1. Determine what to review:
   - If user provides a PR number or link: use `gh pr diff` to fetch it
   - If uncommitted changes exist: review those
   - Otherwise: review the last commit
2. Read the full file(s) being modified to understand context
3. Apply review criteria
4. Produce findings ranked by severity

## What to Look For

**Bugs** -- Primary focus:
- Logic errors, off-by-one mistakes, incorrect conditionals
- Missing guards, unreachable code paths, broken error handling
- Edge cases: null/empty inputs, race conditions
- Security: injection, auth bypass, data exposure

**Structure** -- Does the code fit the codebase?
- Follows existing patterns and conventions?
- Uses established abstractions?
- Excessive nesting that could be flattened?

## Before You Flag Something

- **Be certain.** Don't flag something as a bug if you're unsure -- investigate first
- **Don't invent hypothetical problems.** If an edge case matters, explain the realistic scenario
- **Don't be a zealot about style.** Some "violations" are acceptable when they're the simplest option
- Only review the changes -- not pre-existing code that wasn't modified

## Output

- Be direct about bugs and why they're bugs
- Communicate severity honestly -- don't overstate
- Include file paths and line numbers
- Suggest fixes when appropriate
