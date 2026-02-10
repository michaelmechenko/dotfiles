# Discovery Prompts

## Core Explore Agents

Launch ALL in a single message for parallel execution:

```
Task(
  description="project structure",
  subagent_type="explore",
  prompt="Project structure: PREDICT standard patterns for detected language → REPORT deviations only"
)

Task(
  description="entry points",
  subagent_type="explore",
  prompt="Entry points: FIND main files → REPORT non-standard organization"
)

Task(
  description="conventions",
  subagent_type="explore",
  prompt="Conventions: FIND config files (.eslintrc, pyproject.toml, .editorconfig) → REPORT project-specific rules"
)

Task(
  description="anti-patterns",
  subagent_type="explore",
  prompt="Anti-patterns: FIND 'DO NOT', 'NEVER', 'ALWAYS', 'DEPRECATED' comments → LIST forbidden patterns"
)

Task(
  description="build/ci",
  subagent_type="explore",
  prompt="Build/CI: FIND .github/workflows, Makefile → REPORT non-standard patterns"
)

Task(
  description="test patterns",
  subagent_type="explore",
  prompt="Test patterns: FIND test configs, test structure → REPORT unique conventions"
)
```

## Dynamic Agent Spawning

After bash analysis, spawn ADDITIONAL explore agents based on project scale. **Max 10 additional agents.**

Use judgment based on these signals:

| Signal                       | Threshold | Guidance                         |
| ---------------------------- | --------- | -------------------------------- |
| **Total files**              | >100      | Add agents for breadth           |
| **Total lines**              | >10k      | Add agents for depth             |
| **Directory depth**          | >=4       | Add deep-exploration agents      |
| **Large files (>500 lines)** | >10 files | Add complexity-focused agents    |
| **Monorepo**                 | detected  | Add per-package/workspace agents |
| **Multiple languages**       | >1        | Add per-language agents          |

### Measuring Project Scale

```bash
total_files=$(find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | wc -l)
total_lines=$(find . -type f \( -name "*.ts" -o -name "*.py" -o -name "*.go" \) -not -path '*/node_modules/*' -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
large_files=$(find . -type f \( -name "*.ts" -o -name "*.py" \) -not -path '*/node_modules/*' -exec wc -l {} + 2>/dev/null | awk '$1 > 500 {count++} END {print count+0}')
max_depth=$(find . -type d -not -path '*/node_modules/*' -not -path '*/.git/*' | awk -F/ '{print NF}' | sort -rn | head -1)
```

### Example Additional Agents

```
Task(description="large files", subagent_type="explore",
  prompt="Large file analysis: FIND files >500 lines, REPORT complexity hotspots")

Task(description="deep modules", subagent_type="explore",
  prompt="Deep modules at depth 4+: FIND hidden patterns, internal conventions")

Task(description="cross-cutting", subagent_type="explore",
  prompt="Cross-cutting concerns: FIND shared utilities across directories")
```

## Main Session: Concurrent Analysis

While Task agents execute, the main session does:

### Bash Structural Analysis

```bash
# Directory depth + file counts
find . -type d -not -path '*/\.*' -not -path '*/node_modules/*' -not -path '*/venv/*' -not -path '*/dist/*' -not -path '*/build/*' | awk -F/ '{print NF-1}' | sort -n | uniq -c

# Files per directory (top 30)
find . -type f -not -path '*/\.*' -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -30

# Code concentration by extension
find . -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.go" -o -name "*.rs" \) -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -20

# Existing AGENTS.md / CLAUDE.md
find . -type f \( -name "AGENTS.md" -o -name "CLAUDE.md" \) -not -path '*/node_modules/*' 2>/dev/null
```

### Read Existing AGENTS.md

For each file found: Read, extract key insights/conventions/anti-patterns, store in EXISTING_AGENTS map.

If `--create-new`: Read all existing first (preserve context), then delete all, then regenerate.

### LSP Codemap (if available)

```
lsp_servers()  # Check availability

# Entry points (parallel)
lsp_document_symbols(filePath="src/index.ts")
lsp_document_symbols(filePath="main.py")

# Key symbols (parallel)
lsp_workspace_symbols(filePath=".", query="class")
lsp_workspace_symbols(filePath=".", query="interface")
lsp_workspace_symbols(filePath=".", query="function")

# Centrality for top exports
lsp_find_references(filePath="...", line=X, character=Y)
```

**LSP Fallback**: If unavailable, rely on explore agents + AST-grep.

Merge: bash + LSP + existing + Task agent results.
