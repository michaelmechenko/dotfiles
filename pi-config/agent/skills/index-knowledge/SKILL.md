---
name: index-knowledge
description: "Generate hierarchical AGENTS.md knowledge base for a codebase. Creates root + complexity-scored subdirectory documentation."
disable-model-invocation: true
---

# index-knowledge

Generate hierarchical `AGENTS.md` files. Root + complexity-scored subdirectories. `AGENTS.md` is
the cross-tool convention (read natively by pi, and by Claude Code/other tools when symlinked to
their own expected filename) — see [discovery-prompts.md](references/discovery-prompts.md) for
how existing `AGENTS.md`/`CLAUDE.md` files are detected either way.

## Usage

- `--create-new` -- Read existing, remove all, regenerate from scratch
- `--max-depth=N` -- Limit directory depth (default: 5)
- Default: Update mode (modify existing + create new where warranted)

## Workflow

1. **Discovery + Analysis** (concurrent)
2. **Score & Decide** locations
3. **Generate** root first, then subdirs in parallel
4. **Review** deduplicate, trim, validate

Delegate exploration to parallel subagents (see below) and track progress across the four phases in your own response.

## Phase 1: Discovery + Analysis

Launch explore subagents in parallel:
- Project structure (predict standard patterns, report deviations)
- Entry points (find main files, report non-standard organization)
- Conventions (find config files, report project-specific rules)
- Anti-patterns (find DO NOT/NEVER/ALWAYS/DEPRECATED comments)
- Build/CI (find workflows, Makefiles, report non-standard patterns)
- Test patterns (find test configs, report unique conventions)

Concurrently: bash structural analysis, read existing `AGENTS.md`/`CLAUDE.md` files. See [discovery-prompts.md](references/discovery-prompts.md).

## Phase 2: Scoring & Location Decision

Score each directory using weighted factors. See [scoring-matrix.md](references/scoring-matrix.md).

- Root (.) -- ALWAYS create
- Score >15 -- Create AGENTS.md
- Score 8-15 -- Create if distinct domain
- Score <8 -- Skip (parent covers)

## Phase 3: Generate

1. Generate root AGENTS.md (50-150 lines, full treatment)
2. Launch subagents for each subdir location in parallel

See [generation-templates.md](references/generation-templates.md).

## Phase 4: Review & Deduplicate

Remove generic advice, remove parent duplicates, trim to size limits, verify telegraphic style.

## Anti-Patterns

- Static agent count (MUST vary based on project size)
- Sequential execution (MUST parallel)
- Ignoring existing (ALWAYS read existing first)
- Over-documenting (not every dir needs AGENTS.md)
- Redundancy (child never repeats parent)
- Generic content (remove anything that applies to ALL projects)
