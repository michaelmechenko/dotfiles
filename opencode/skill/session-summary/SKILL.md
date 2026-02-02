---
name: session-summary
description: Generate session handoff summaries for context preservation. Use at session end, before breaks, or when transferring context to new session/agent.
---

# Session Summary for Handoff

## When to Use

- Ending a long session
- Before switching tasks
- Preparing for another person/agent to continue
- Context approaching overflow

## Summary Structure

### 1. TL;DR (2-3 sentences)
What was accomplished and current state.

### 2. Work Completed
- List completed items with file paths
- Note any tests run / verification done

### 3. Current State
- Files currently being modified
- Uncommitted changes summary
- Any temporary/debug code in place

### 4. Pending Decisions
- Open questions awaiting user input
- Trade-offs identified but not resolved
- Alternatives considered

### 5. User Preferences (Discovered)
- Coding style preferences expressed
- Tool preferences (e.g., "user prefers pnpm over npm")
- Communication preferences

### 6. Next Steps
Ordered list of immediate next actions.

### 7. Context to Preserve
Critical information that must not be lost:
- Environment-specific details
- Auth/config not in code
- External dependencies/blockers

## Generation Commands

```bash
# Get recent changes for context
git diff --stat HEAD~5
git log --oneline -10

# Current working tree state
git status --porcelain

# Uncommitted work details
git diff --cached --stat
git diff --stat
```

## Output Format

```markdown
# Session Handoff: [Brief Title]

**Date:** [timestamp]
**Duration:** [approximate]
**Session ID:** [if available]

## TL;DR
[2-3 sentences]

## Completed
- [x] Item 1 (files: `path/to/file.ts`)
- [x] Item 2

## In Progress
- [ ] Item being worked on
  - Current state: [description]
  - Blockers: [if any]

## Decisions Pending
1. [Decision needed]
   - Option A: [pros/cons]
   - Option B: [pros/cons]

## User Preferences
- [Preference discovered during session]

## Next Steps
1. [Immediate next action]
2. [Following action]

## Critical Context
- [Environment detail]
- [External dependency]
```

## Anti-Patterns

- Don't include implementation details model already knows
- Don't repeat file contents
- Don't list every file touched (summarize)
- Don't include sensitive data (keys, tokens)
