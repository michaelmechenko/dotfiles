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

## Which session

**Default: the current session.** Summarize the conversation in progress plus the working-tree
state below — no file parsing needed.

To summarize a *different* session, locate it first:
- `~/.config/claude/sessions/<pid>.json` — one file per session, holds `sessionId`, `cwd`,
  `status`, `startedAt`. Match on `cwd` to find sessions for a given project.
- `~/.config/claude/projects/<project-slug>/<sessionId>.jsonl` — the full transcript. The slug
  is the project cwd with `/` and `.` → `-` (e.g. `/Users/michael.mechenko/.config` →
  `-Users-michael-mechenko--config`).
- Parse the `.jsonl` (one JSON object per line) for user/assistant turns and tool calls to
  reconstruct goals, work done, and open items.

Prefer `/smap-read` first — if a session map exists for the project it already records goals,
done, and open items per session, which is cheaper than re-parsing transcripts.

## Generation Commands (current session)

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
