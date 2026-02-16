---
name: grep
description: "Use ripgrep (rg) to search any folder/file for context. Use when you need to find code patterns, search across projects, count matches, or explore unfamiliar codebases."
---

# Grep Skill

## Goal

Find patterns, files, or context using ripgrep efficiently.

## When to Use

- Finding function/class definitions
- Searching for TODO comments or patterns
- Finding all usages of a variable or function
- Exploring unfamiliar codebases
- Finding error messages in logs
- Finding hardcoded config values
- Searching for API endpoints

## Quick Reference

### Common Flags

- `-l` -- List files only (no matches)
- `-c` -- Count matches per file
- `-i` -- Case-insensitive
- `-s` -- Case-sensitive
- `-w` -- Whole word match
- `-F` -- Fixed string (no regex)
- `-u` -- Search hidden files
- `-g` -- Glob pattern filter
- `-t` -- File type filter
- `-B` -- Lines before match
- `-A` -- Lines after match

### Example Commands

```bash
# Basic search (case-insensitive)
rg "pattern" .

# List files with pattern
rg -l "pattern" .

# Count matches per file
rg -c "pattern" .

# Case-sensitive
rg -s "pattern" .

# Regex search
rg "func\s+\w+\(" .

# Search specific file types
rg "pattern" . -t ts -t js

# Exclude patterns
rg "pattern" . --glob "!*test*"

# Show context (2 lines before/after)
rg "pattern" . -B2 -A2

# Search hidden files
rg "pattern" . -u

# Whole word match
rg -w "pattern" .

# Fixed string (no regex)
rg -F "pattern" .

# Limit results
rg "pattern" . | head -50
```

## Workflow

1. Identify search target (file, folder, or project root)
2. Choose appropriate flags for the task
3. Start with basic search, refine as needed
4. Use `--glob`, `-t`, or `-u` to narrow scope
5. Pipe to `head` if results are large