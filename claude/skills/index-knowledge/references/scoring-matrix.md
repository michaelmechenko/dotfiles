# Scoring Matrix

## Factors

- File count (3x weight) -- High: >20
- Subdir count (2x) -- High: >5
- Code ratio (2x) -- High: >70%
- Unique patterns (1x) -- Has own config
- Module boundary (2x) -- Has index.ts/__init__.py
- Symbol density (2x) -- >30 symbols
- Export count (2x) -- >10 exports
- Reference centrality (3x) -- >20 refs

## Decision Rules

- Root (.) -- ALWAYS create
- Score >15 -- Create CLAUDE.md
- Score 8-15 -- Create if distinct domain
- Score <8 -- Skip (parent covers)
