---
name: search
description: "Search for content or files using ripgrep (rg) and fd. Use when you need to find files or patterns quickly."
argument-hint: "[pattern] [in /path/to/dir]"
---

# Search

## Workflow

1. Parse search query and optional path from arguments
2. Detect search type:
   - Pattern with wildcards (*.ts, *.js) -> fd (file name search)
   - Plain words -> rg (content search)
3. Set search path: use provided path, otherwise default to current directory
4. Run appropriate command:
   - rg: `rg -l 'pattern' {path}` or `rg 'pattern' {path} -C2`
   - fd: `fd 'pattern' {path}` or `fd -e ext {path}`
5. Present results clearly with file counts and match info
