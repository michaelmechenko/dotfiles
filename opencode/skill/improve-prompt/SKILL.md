---
name: improve-prompt
description: Prompt engineering patterns for LLM optimization. Load when crafting complex prompts, teaching prompt structure, or reviewing prompt quality.
---

# Prompt Engineering Patterns

## Quick Templates

### Analysis Task

```xml
<role>Expert {domain} analyst</role>
<context>{background}</context>
<objective>{specific goal}</objective>
<constraints>{limitations}</constraints>
<output>Structured findings with evidence</output>
```

### Creative Task

```xml
<role>Creative {specialty}</role>
<context>{inspiration/requirements}</context>
<instructions>Don't hold back. Give it your all.</instructions>
<output>{format}</output>
```

### Technical Task

```xml
<role>Senior {technology} engineer</role>
<context>{codebase/architecture}</context>
<task>{specific implementation}</task>
<constraints>
- Minimal changes
- Preserve existing patterns
- Include error handling
</constraints>
<verification>Test cases or validation steps</verification>
```

## Enhancement Checklist

- [ ] Role clearly defined?
- [ ] Context sufficient?
- [ ] Output format explicit?
- [ ] Constraints stated?
- [ ] Examples provided (if complex)?
- [ ] Verification criteria included?

## Model-Specific Optimizations

### Claude

- Use XML tags for structure
- `<thinking>` for complex reasoning
- "Think step by step" effective
- Specific output formats work well

### GPT

- Markdown structure works well
- System vs user message separation
- Chain-of-thought in user message
- JSON mode for structured output

### Gemini

- Explicit output format critical
- Examples highly effective
- Multimodal: describe images explicitly
- Grounding with Google Search

## Common Patterns

### Multi-Step Workflow

```xml
<role>Workflow orchestrator</role>
<task>
1. [Step 1 description]
2. [Step 2 description]
3. [Step 3 description]
</task>
<checkpoints>
- Verify [X] after step 1
- Confirm [Y] before step 3
</checkpoints>
```

### Code Review

```xml
<role>Senior code reviewer</role>
<context>
Codebase: [language/framework]
Recent changes: [description]
</context>
<review_criteria>
- Correctness and edge cases
- Security vulnerabilities
- Performance implications
- Maintainability
</review_criteria>
<output>
Findings with severity levels + specific line references
</output>
```

### Research Task

```xml
<role>Research analyst</role>
<objective>Answer: [question]</objective>
<sources>
- [Source 1]
- [Source 2]
</sources>
<instructions>
1. Search relevant sources
2. Cross-reference findings
3. Cite specific evidence
</instructions>
<output>
Summary with citations
</output>
```

## Anti-Patterns to Avoid

- Vague roles ("helpful assistant")
- Missing output format
- Assuming model knows context
- Too many instructions (>10 main points)
- Mixing multiple unrelated tasks
- No verification criteria

## Progressive Refinement

1. **Start simple** - Basic role + task
2. **Add constraints** - If output too broad
3. **Add examples** - If format unclear
4. **Add verification** - If accuracy matters
5. **Add thinking** - If reasoning needed
