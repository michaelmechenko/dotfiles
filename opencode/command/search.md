---
description: Search files using rg and fd
---

Search for content or files using ripgrep and fd.

<user-request>
$ARGUMENTS
</user-request>

1. Parse search query and optional path from $ARGUMENTS
2. Format: "/search pattern" or "/search pattern in /path/to/dir"
3. Detect search type:
   - Pattern with wildcards (*.ts, *.js, *.json) → fd (file name search)
   - Plain words → rg (content search)
4. Set search path: use provided path, otherwise default to current directory
5. Run appropriate command:
   - rg: "rg -l 'pattern' {path}" or "rg 'pattern' {path} -c"
   - fd: "fd 'pattern' {path}" or "fd -e ext {path}"
6. Present results clearly with file counts and match info