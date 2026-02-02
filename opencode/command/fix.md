---
description: Quick fix for last error
subtask: true
---

Analyze the most recent error and apply a minimal fix.

<context>
Error context: $ARGUMENTS
</context>

<workflow>
1. Identify the error from recent output or user description
2. Locate the source file and line
3. Determine root cause
4. Apply minimal, surgical fix
5. Verify fix addresses the error without breaking other code
</workflow>

<constraints>
- Make the smallest change that fixes the error
- Don't refactor or improve unrelated code
- Preserve existing patterns and style
- If fix requires larger changes, explain and ask before proceeding
</constraints>

<output>
- Error identified
- Root cause explanation
- Fix applied
- Verification steps (if needed)
</output>
