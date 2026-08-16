# Tool-frame migration handoff

## Current state

The custom-tool frame work is partially implemented and intentionally not ready for a final visual commit.

Canonical frame code now lives in `pi-config/agent/extensions/tool-display/frame.ts`. It provides:

- `frameRow`, `framePadding`, `frameDivider`, and `frameRows` for ANSI-aware text rows
- `frameResult` and `frameText` for width-aware text renderers
- `frameComponentResult` for rich `Component` results; child components render at the interior width and every emitted line receives the outer frame
- `toolCallFrame` and `toolResultFrame` as compatibility helpers for existing small text-only extensions
- `toolErrorFrame` and `toolEmptyFrame` as compatibility helpers

The component adapter is the required seam for `Container`, `Markdown`, and other rich results. Do not add another renderer-specific outer-frame implementation.

The vendored `pretty` and `diff` top-level shims must re-export `./src/index.ts`; their source trees contain TypeScript entrypoints, not `src/index.js`. A fresh explicit-agent-dir session confirmed both extensions load after this correction.

`frameRow` reapplies the selected semantic row background after embedded full SGR resets and terminates the background at the row boundary. Pending calls use `toolPendingBg`; successful results use `toolSuccessBg`; failures use `toolErrorBg`. These surfaces intentionally differ, while rows within each state remain continuous.

`pretty/src/frame.ts` was removed. Pretty tools should import the canonical adapter directly from `../../../tool-display/frame.js`.

`pi-config/agent/extensions/tool-display/frame-contract-check.mjs` is the current static guardrail. Run:

```bash
node pi-config/agent/extensions/tool-display/frame-contract-check.mjs
pi --help
 git diff --check
```

The harness currently checks canonical exports, the rich-component adapter, ANSI-width fitting fixtures, one-cell row fitting, diff marker removal, absence of the duplicate pretty frame module, and the bash status-header indent.

## Known incomplete work

1. Fresh-process visual verification of the complete resize/sidebar matrix remains mandatory. The focused visual matrix confirmed custom read/bash/find/grep/ls, diff, session-recall, web, and ask-user renderers load; the subagent run was blocked by the available model/API credit error.
2. `toolCallFrame` and `toolResultFrame` remain compatibility helpers because `ask-user`, `plan-mode`, and `web-tools` still use them. Consolidate those callers before deleting the helpers or the positional `frameResult` signature.
3. Keep `frameComponentResult` as the only component-aware outer-frame seam. Rich results must not be inserted directly into an unframed `Container`.

## Visual contract

Every custom tool frame should render:

```text
[top padding row]
[call rows]
[one divider row]
[result rows]
[bottom padding row]
```

Every outer row must have exactly one plain space at both edges after ANSI-aware fitting. Status markers share one column. Line-number, tree, search, and diff gutters are interior content and must not change the outer frame padding.

`ctrl+o` controls Pi result details. `ctrl+shift+o` controls extension-owned call/input details. Continuation hints should appear only where content is omitted.

## Recent control changes

- `thinking-controls/` registers `f13` for backward thinking-level cycling. Ghostty maps `ctrl+tab` to F13 in `ghostty/config`.
- `session-rename/` registers `ctrl+r` and `/rename [name]`.
- `app.session.rename` is cleared in `keybindings.json` so the live-editor shortcut can be owned by the extension.
- `vague.json` thinking colors use muted `#656A80` for low/lower, lavender `#AEAED1` for medium, and dusty pink `#BB9DBD` for high/greater.
- Plan-mode stopped-execution options now order Resume, Adjust, All done, Stop.

These controls have static load checks but still need live verification.

## Scope and commit caution

The working tree contains unrelated concurrent changes. Do not stage these unless explicitly requested:

- `.gitignore`
- `pi-config/agent/settings.json`
- `tmux.conf`
- `tmux_sessions/`

The intended pi migration files from this session include the custom extensions, frame harness, pi documentation, `KEYBINDS.md`, `COLORS.md`, and the pi theme/keybinding changes. Review `git diff` and stage explicit paths only.
