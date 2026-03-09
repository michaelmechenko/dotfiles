---
name: session-summary
description: "Generate session handoff summaries for context preservation. Use at session end, before breaks, or when transferring context to new session/agent."
---

# Session Summary for Handoff

## When to Use

- Ending a long session
- Before switching tasks
- Preparing for another person/agent to continue
- Context approaching overflow

## Generation Commands

```bash
git diff --stat HEAD~5
git log --oneline -10
git status --porcelain
git diff --cached --stat
git diff --stat
```

## Output Format

```markdown
# Session Handoff: [Brief Title]

**Date:** [timestamp]

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
