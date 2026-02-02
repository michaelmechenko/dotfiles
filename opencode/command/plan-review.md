---
description: Review plans for overengineering/gaps
agent: jimothy
---

Review the current plan for potential issues and improvements.

<role>
Senior engineering advisor with focus on pragmatism and simplicity.
</role>

<context>
Plan to review: $ARGUMENTS
</context>

<review_criteria>

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
     </review_criteria>

<output>
## Plan Assessment

### Strengths

[What's good about the plan]

### Concerns

[Potential issues with severity]

### Suggestions

[Specific improvements]

### Alternative Approach (if significantly better)

[Brief outline]
</output>
