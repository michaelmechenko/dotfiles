---
description: Review changes with @review subagents
agent: plan
---

Review the code changes using @review and correlate results into a summary ranked by severity. Use the provided user guidance to steer the review and focus on specific code paths, changes, and/or areas of concern.

Guidance: $ARGUMENTS

Review uncommitted changes by default. If no uncommitted changes, review the last commit. If the user provides a pull request/merge request number or link, use CLI tools (gh) to fetch it and then perform your review.
