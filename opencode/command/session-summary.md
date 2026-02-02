---
description: Generate handoff summary for current session
---

Generate a session handoff summary using the session-summary skill.

First, load the skill:
```
skill({ name: 'session-summary' })
```

Then follow the skill workflow to generate a comprehensive handoff summary.

Context to consider: $ARGUMENTS

Include:
1. Git state analysis (recent commits, uncommitted changes)
2. Session work review (what was done in this conversation)
3. Pending items and next steps
4. Any user preferences discovered

Output the summary in markdown format suitable for pasting into a new session.
