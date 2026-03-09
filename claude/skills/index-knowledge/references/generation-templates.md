# Generation Templates

## Root CLAUDE.md Template

```markdown
# PROJECT KNOWLEDGE BASE

**Generated:** {TIMESTAMP}
**Commit:** {SHORT_SHA}

## OVERVIEW
{1-2 sentences: what + core stack}

## STRUCTURE
{root}/
  {dir}/ # {non-obvious purpose only}
  {entry}

## WHERE TO LOOK
- Task: location (notes)

## CONVENTIONS
{ONLY deviations from standard}

## ANTI-PATTERNS (THIS PROJECT)
{Explicitly forbidden here}

## COMMANDS
{dev/test/build}

## NOTES
{Gotchas}
```

Quality gates: 50-150 lines, no generic advice, no obvious info.

## Subdirectory CLAUDE.md

Launch general-purpose agents for each scored location in parallel using the Task tool:

- 30-80 lines max
- NEVER repeat parent content
- Sections: OVERVIEW (1 line), STRUCTURE (if >5 subdirs), WHERE TO LOOK, CONVENTIONS (if different), ANTI-PATTERNS

## Review Checklist

- Remove generic advice (anything true of ALL projects)
- Remove parent duplicates (child never repeats parent)
- Trim to size limits (root: 50-150, subdir: 30-80)
- Verify telegraphic style
