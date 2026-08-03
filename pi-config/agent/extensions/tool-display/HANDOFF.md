# Tool-frame migration handoff

## Current state

The custom-tool frame work is partially implemented and intentionally not ready for a final visual commit.

Canonical frame code now lives in `pi-config/agent/extensions/tool-display/frame.ts`. It provides:

- `frameRow`, `framePadding`, `frameDivider`, and `frameRows`
- `frameResult`
- `toolCallFrame` and `toolResultFrame` for separate Pi render slots
- `toolFrameContainer` for future component-aware renderers
- `toolErrorFrame` and `toolEmptyFrame`
- `frameText` for width-aware repainting

`pretty/src/frame.ts` was removed. Pretty tools should import the canonical adapter directly from `../../../tool-display/frame.js`.

`pi-config/agent/extensions/tool-display/frame-contract-check.mjs` is the current static guardrail. Run:

```bash
node pi-config/agent/extensions/tool-display/frame-contract-check.mjs
pi --help
 git diff --check
```

The harness currently checks canonical exports, one-cell row fitting, diff marker removal, absence of the duplicate pretty frame module, and the bash status-header indent.

## Known incomplete work

1. `pretty` result branches still bypass the canonical adapter:
   - `read`: error, image, expanded syntax, async highlight replacement, and fallback paths
   - `bash`: empty output, error, and fallback paths
   - `find`: empty and fallback paths
   - `ls`: error/fallback and some expanded paths
2. `diff/src/index.ts` still has raw `TOOL_RESULT_INDENT`, `formatToolFrameHeaderText`, and direct `text.setText` paths in apply_patch metadata, no-change, error, new-file, and fallback branches.
3. `subagent` and `session-recall` still use rich `Container`/Markdown renderers without the component-aware adapter.
4. Live fresh-process visual verification has not been performed. Do not call the migration complete based only on `/reload` or `pi --help`.
5. The current frame helpers have accumulated compatibility APIs (`toolFrame`, `toolCallFrame`, `toolResultFrame`, and object/positional `frameResult`). Consolidate only after all callers migrate.

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

`ctrl+o` controls Pi call details. `ctrl+shift+o` controls extension-owned result details. Continuation hints should appear only where content is omitted.

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
