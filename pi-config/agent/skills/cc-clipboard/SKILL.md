---
name: cc-clipboard
description: "Pipe relevant content to the system clipboard. Use when asked to copy something to clipboard, or when instructed to make content available for pasting. Pass -l/--lowercase to lowercase the copied content."
allowed-tools: bash read grep find
---

# Copy Content to Clipboard

Identify the requested content, then pipe it to the cross-platform `copy` helper
(`pbcopy` on macOS, `wl-copy` on Wayland).

## Flags

- `-l` / `--lowercase` — insert `tr '[:upper:]' '[:lower:]'` immediately before `copy`.

## Workflow

1. Check whether lowercasing was requested.
2. Determine the requested content.
3. Read or generate it.
4. Pipe it to `copy`, routing through `tr` first when requested.
5. Briefly confirm what was copied without echoing the full content.

## Examples

- Whole file: `cat path/to/file | copy`
- Line range: `sed -n '10,25p' path/to/file | copy`
- Command output: `some-command | copy`
- Generated text: `printf '%s' 'content' | copy`
- Search results: `rg 'pattern' path | copy`
- Lowercased: `cat path/to/file | tr '[:upper:]' '[:lower:]' | copy`

Warn before copying unusually large content. Use a user-specified file or pattern directly.
