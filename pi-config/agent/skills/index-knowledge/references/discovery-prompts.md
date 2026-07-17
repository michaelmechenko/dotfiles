# Discovery Prompts

## Core Explore Agents

Launch ALL in a single message for parallel execution using the `subagent` tool's parallel mode, `agent: "scout"` for each:

- **project structure** -- "Project structure: PREDICT standard patterns for detected language, REPORT deviations only"
- **entry points** -- "Entry points: FIND main files, REPORT non-standard organization"
- **conventions** -- "Conventions: FIND config files (.eslintrc, pyproject.toml, .editorconfig), REPORT project-specific rules"
- **anti-patterns** -- "Anti-patterns: FIND 'DO NOT', 'NEVER', 'ALWAYS', 'DEPRECATED' comments, LIST forbidden patterns"
- **build/ci** -- "Build/CI: FIND .github/workflows, Makefile, REPORT non-standard patterns"
- **test patterns** -- "Test patterns: FIND test configs, test structure, REPORT unique conventions"

## Dynamic Agent Spawning

After bash analysis, spawn ADDITIONAL explore agents (`scout`) based on project scale. Max 10 additional.

- Total files >100 -- Add agents for breadth
- Total lines >10k -- Add agents for depth
- Directory depth >=4 -- Add deep-exploration agents
- Large files (>500 lines) >10 -- Add complexity-focused agents
- Monorepo detected -- Add per-package/workspace agents
- Multiple languages >1 -- Add per-language agents

## Main Session: Concurrent Analysis

### Bash Structural Analysis

```bash
# Directory depth + file counts
find . -type d -not -path '*/\.*' -not -path '*/node_modules/*' | awk -F/ '{print NF-1}' | sort -n | uniq -c

# Files per directory (top 30)
find . -type f -not -path '*/\.*' -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -30

# Code concentration by extension
find . -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.go" -o -name "*.rs" \) -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -20

# Existing AGENTS.md / CLAUDE.md
find . -type f \( -name "AGENTS.md" -o -name "CLAUDE.md" \) -not -path '*/node_modules/*' 2>/dev/null
```

### Read Existing AGENTS.md / CLAUDE.md

For each file found: Read, extract key insights/conventions/anti-patterns, store in map. If both
`AGENTS.md` and `CLAUDE.md` exist and aren't a symlink pair, treat `AGENTS.md` as canonical and
flag the divergence to the user rather than silently picking one.
If `--create-new`: Read all existing first, then delete all, then regenerate.
