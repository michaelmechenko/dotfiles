---
description: Add a learning to learnings.md
---

Record a new learning from user guidance or corrections.

<user-request>
$ARGUMENTS
</user-request>

Before recording, ask the user to choose the scope:
- "project" = add to project-level learnings
- "global" = add to ~/.config/opencode/learnings.md
- "both" = add to both files

Then invoke the learner subagent with the learning context.