# Generation Templates

## Root AGENTS.md Template

```markdown
# PROJECT KNOWLEDGE BASE

**Generated:** {TIMESTAMP}
**Commit:** {SHORT_SHA}
**Branch:** {BRANCH}

## OVERVIEW

{1-2 sentences: what + core stack}

## STRUCTURE

\`\`\`
{root}/
├── {dir}/ # {non-obvious purpose only}
└── {entry}
\`\`\`

## WHERE TO LOOK

| Task | Location | Notes |
| ---- | -------- | ----- |

## CODE MAP

{From LSP - skip if unavailable or project <10 files}

| Symbol | Type | Location | Refs | Role |

## CONVENTIONS

{ONLY deviations from standard}

## ANTI-PATTERNS (THIS PROJECT)

{Explicitly forbidden here}

## UNIQUE STYLES

{Project-specific}

## COMMANDS

\`\`\`bash
{dev/test/build}
\`\`\`

## NOTES

{Gotchas}
```

**Quality gates**: 50-150 lines, no generic advice, no obvious info.

## Subdirectory AGENTS.md

Launch general agents for each scored location in ONE message (parallel):

```
Task(
  description="AGENTS.md for {path}",
  subagent_type="general",
  prompt="Generate AGENTS.md for: {path}
    - Reason: {reason from scoring}
    - 30-80 lines max
    - NEVER repeat parent content
    - Sections: OVERVIEW (1 line), STRUCTURE (if >5 subdirs), WHERE TO LOOK, CONVENTIONS (if different), ANTI-PATTERNS
    - Write directly to {path}/AGENTS.md"
)
```

## Review Checklist (Phase 4)

For each generated file:

- Remove generic advice (anything true of ALL projects)
- Remove parent duplicates (child never repeats parent)
- Trim to size limits (root: 50-150, subdir: 30-80)
- Verify telegraphic style

## Final Report Format

```
=== index-knowledge Complete ===

Mode: {update | create-new}

Files:
  ✓ ./AGENTS.md (root, {N} lines)
  ✓ ./{path}/AGENTS.md ({N} lines)

Dirs Analyzed: {N}
AGENTS.md Created: {N}
AGENTS.md Updated: {N}

Hierarchy:
  ./AGENTS.md
  └── {path}/AGENTS.md
```
