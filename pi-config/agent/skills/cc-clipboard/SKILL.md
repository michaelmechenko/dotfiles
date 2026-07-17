---
name: cc-clipboard
description: "Pipe relevant content to the clipboard via pbcopy. Use when asked to copy something to clipboard, or when instructed to make content available for pasting. Pass -l/--lowercase to lowercase the copied content."
allowed-tools: bash read grep find
---

# Copy Content to Clipboard

Identify the content the user wants copied, then pipe it to `pbcopy`.

## Flags

- `-l` / `--lowercase` — lowercase the content before copying by inserting
  `tr '[:upper:]' '[:lower:]'` in the pipe just before `pbcopy`. Applies to whatever content
  the skill would otherwise copy (file, command output, generated text, search results).

## Workflow

1. Check whether the user asked for lowercasing; the remainder of their request is the file/pattern hint (if any).
2. Determine what content is requested (file, code block, command output, search result, etc.)
3. Read or generate the content.
4. Pipe it to `pbcopy` via bash — routing through `tr` first when lowercase is requested.

## Examples

- **Whole file**: `cat path/to/file | pbcopy`
- **Line range**: `sed -n '10,25p' path/to/file | pbcopy`
- **Command output**: `some-command | pbcopy`
- **Generated text**: `echo 'content' | pbcopy`
- **Search results**: `rg 'pattern' path | pbcopy`
- **Lowercased**: `cat path/to/file | tr '[:upper:]' '[:lower:]' | pbcopy`

## Guidelines

- Always confirm what was copied (brief summary, not the full content); note when it was lowercased.
- For large content, warn the user before copying
- If the user specified a file or pattern, use that directly
