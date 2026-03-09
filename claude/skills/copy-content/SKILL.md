---
name: copy-content
description: "Pipe relevant content to the clipboard via pbcopy. Use when asked to copy something to clipboard, or when instructed to make content available for pasting."
allowed-tools: Bash, Read, Grep, Glob
---

# Copy Content to Clipboard

Identify the content the user wants copied, then pipe it to `pbcopy`.

## Workflow

1. Determine what content is requested (file, code block, command output, search result, etc.)
2. Read or generate the content
3. Pipe it to `pbcopy` via Bash

## Examples

- **Whole file**: `cat path/to/file | pbcopy`
- **Line range**: `sed -n '10,25p' path/to/file | pbcopy`
- **Command output**: `some-command | pbcopy`
- **Generated text**: `echo 'content' | pbcopy`
- **Search results**: `rg 'pattern' path | pbcopy`

## Guidelines

- Always confirm what was copied (brief summary, not the full content)
- For large content, warn the user before copying
- If $ARGUMENTS specifies a file or pattern, use that directly
