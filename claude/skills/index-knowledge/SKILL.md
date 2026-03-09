---
name: index-knowledge
description: "Generate hierarchical CLAUDE.md knowledge base for a codebase. Creates root + complexity-scored subdirectory documentation."
argument-hint: "[--create-new] [--max-depth=N]"
---

# index-knowledge

Generate hierarchical CLAUDE.md files. Root + complexity-scored subdirectories.

## Usage

- `--create-new` -- Read existing, remove all, regenerate from scratch
- `--max-depth=N` -- Limit directory depth (default: 5)
- Default: Update mode (modify existing + create new where warranted)

## Workflow

1. **Discovery + Analysis** (concurrent)
2. **Score & Decide** locations
3. **Generate** root first, then subdirs in parallel
4. **Review** deduplicate, trim, validate

Use Task tool to parallelize exploration agents. Track all phases with tasks.

## Phase 1: Discovery + Analysis

Launch explore agents in parallel:
- Project structure (predict standard patterns, report deviations)
- Entry points (find main files, report non-standard organization)
- Conventions (find config files, report project-specific rules)
- Anti-patterns (find DO NOT/NEVER/ALWAYS/DEPRECATED comments)
- Build/CI (find workflows, Makefiles, report non-standard patterns)
- Test patterns (find test configs, report unique conventions)

Concurrently: bash structural analysis, read existing CLAUDE.md files. See `references/discovery-prompts.md`.

## Phase 2: Scoring & Location Decision

Score each directory using weighted factors. See `references/scoring-matrix.md`.

- Root (.) -- ALWAYS create
- Score >15 -- Create CLAUDE.md
- Score 8-15 -- Create if distinct domain
- Score <8 -- Skip (parent covers)

## Phase 3: Generate

1. Generate root CLAUDE.md (50-150 lines, full treatment)
2. Launch agents for each subdir location in parallel

See `references/generation-templates.md`.

## Phase 4: Review & Deduplicate

Remove generic advice, remove parent duplicates, trim to size limits, verify telegraphic style.

## Anti-Patterns

- Static agent count (MUST vary based on project size)
- Sequential execution (MUST parallel)
- Ignoring existing (ALWAYS read existing first)
- Over-documenting (not every dir needs CLAUDE.md)
- Redundancy (child never repeats parent)
- Generic content (remove anything that applies to ALL projects)
