---
name: index-knowledge
description: Generate hierarchical AGENTS.md knowledge base for a codebase. Creates root + complexity-scored subdirectory documentation.
---

# index-knowledge

Generate hierarchical AGENTS.md files. Root + complexity-scored subdirectories.

## Usage

```
--create-new   # Read existing → remove all → regenerate from scratch
--max-depth=2  # Limit directory depth (default: 5)
```

Default: Update mode (modify existing + create new where warranted)

---

## Workflow

1. **Discovery + Analysis** (concurrent)
2. **Score & Decide** locations
3. **Generate** root first, then subdirs in parallel
4. **Review** deduplicate, trim, validate

<critical>
**TodoWrite ALL phases. Mark in_progress → completed in real-time.**

```
TodoWrite([
  { id: "discovery", content: "Fire explore agents + LSP codemap + read existing", status: "pending", priority: "high" },
  { id: "scoring", content: "Score directories, determine locations", status: "pending", priority: "high" },
  { id: "generate", content: "Generate AGENTS.md files (root + subdirs)", status: "pending", priority: "high" },
  { id: "review", content: "Deduplicate, validate, trim", status: "pending", priority: "medium" }
])
```

</critical>

---

## Phase 1: Discovery + Analysis

**Mark "discovery" as in_progress.**

Launch 6 core explore agents in ONE message (parallel). See [discovery-prompts.md](./references/discovery-prompts.md) for exact prompts.

Concurrently in main session:

1. **Bash structural analysis** -- directory depth, file counts, code concentration
2. **Read existing AGENTS.md** -- extract insights, store in map
3. **LSP codemap** (if available) -- symbols, exports, references; fallback to AST-grep

See [discovery-prompts.md](./references/discovery-prompts.md) for bash commands, LSP calls, and dynamic agent spawning rules (max 10 additional agents based on project scale).

**Merge all results. Mark "discovery" as completed.**

---

## Phase 2: Scoring & Location Decision

**Mark "scoring" as in_progress.**

Score each directory using weighted factors (file count, subdir count, code ratio, module boundaries, symbol density, reference centrality).

See [scoring-matrix.md](./references/scoring-matrix.md) for factor weights, thresholds, and decision rules.

| Score    | Action                    |
| -------- | ------------------------- |
| Root (.) | ALWAYS create             |
| >15      | Create AGENTS.md          |
| 8-15     | Create if distinct domain |
| <8       | Skip (parent covers)      |

**Mark "scoring" as completed.**

---

## Phase 3: Generate

**Mark "generate" as in_progress.**

1. Generate root AGENTS.md (50-150 lines, full treatment)
2. Launch general agents for each subdir location in ONE message (parallel)

See [generation-templates.md](./references/generation-templates.md) for root template, subdir prompt pattern, and quality gates.

**Mark "generate" as completed.**

---

## Phase 4: Review & Deduplicate

**Mark "review" as in_progress.**

For each generated file: remove generic advice, remove parent duplicates, trim to size limits, verify telegraphic style.

See review checklist in [generation-templates.md](./references/generation-templates.md).

**Mark "review" as completed.**

---

## Anti-Patterns

- **Static agent count**: MUST vary agents based on project size/depth
- **Sequential execution**: MUST parallel (multiple Task calls in one message)
- **Ignoring existing**: ALWAYS read existing first, even with --create-new
- **Over-documenting**: Not every dir needs AGENTS.md
- **Redundancy**: Child never repeats parent
- **Generic content**: Remove anything that applies to ALL projects
- **Verbose style**: Telegraphic or die

## In This Reference

| File                                                            | Purpose                                  |
| --------------------------------------------------------------- | ---------------------------------------- |
| [discovery-prompts.md](./references/discovery-prompts.md)       | Explore agent prompts, dynamic spawning  |
| [scoring-matrix.md](./references/scoring-matrix.md)             | Scoring factors, weights, decision rules |
| [generation-templates.md](./references/generation-templates.md) | Root/subdir templates, review, reporting |
