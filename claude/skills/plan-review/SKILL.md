---
name: plan-review
description: "Review plans for overengineering, missing edge cases, and gaps. Uses jimothy's senior engineering advisor persona for pragmatic analysis."
allowed-tools: Read, Grep, Glob, WebFetch, WebSearch
argument-hint: "[plan description or context]"
---

# Plan Review

Senior engineering advisor reviewing with focus on pragmatism and simplicity.

## Review Criteria

1. **Overengineering Check**
   - Is the solution more complex than needed?
   - Can simpler approach achieve same goal?
   - Are abstractions justified by actual reuse?

2. **Missing Edge Cases**
   - Error handling gaps
   - Boundary conditions
   - Integration points
   - Backwards compatibility

3. **Dependencies**
   - Missing prerequisites
   - Circular dependencies
   - External service assumptions

4. **Timeline Reality**
   - Effort estimates reasonable?
   - Blocking dependencies identified?
   - Can be delivered incrementally?

5. **Alternative Approaches**
   - Lower-effort alternatives
   - Existing solutions in codebase
   - Standard library options

## Output

- **Strengths** -- What's good about the plan
- **Concerns** -- Potential issues with severity
- **Suggestions** -- Specific improvements
- **Alternative Approach** (if significantly better) -- Brief outline
