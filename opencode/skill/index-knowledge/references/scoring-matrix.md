# Scoring Matrix

## Factors

| Factor               | Weight | High Threshold           | Source  |
| -------------------- | ------ | ------------------------ | ------- |
| File count           | 3x     | >20                      | bash    |
| Subdir count         | 2x     | >5                       | bash    |
| Code ratio           | 2x     | >70%                     | bash    |
| Unique patterns      | 1x     | Has own config           | explore |
| Module boundary      | 2x     | Has index.ts/__init__.py | bash    |
| Symbol density       | 2x     | >30 symbols              | LSP     |
| Export count         | 2x     | >10 exports              | LSP     |
| Reference centrality | 3x     | >20 refs                 | LSP     |

## Decision Rules

| Score        | Action                    |
| ------------ | ------------------------- |
| **Root (.)** | ALWAYS create             |
| **>15**      | Create AGENTS.md          |
| **8-15**     | Create if distinct domain |
| **<8**       | Skip (parent covers)      |

## Output Format

```
AGENTS_LOCATIONS = [
  { path: ".", type: "root" },
  { path: "src/hooks", score: 18, reason: "high complexity" },
  { path: "src/api", score: 12, reason: "distinct domain" }
]
```
