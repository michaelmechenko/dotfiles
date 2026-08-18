# Plan Mode Extension

Structured planning and execution with separate access restrictions.

## Modes

`Ctrl+P` cycles without opening a dialog:

```
none → plan → read-only → none
```

- **plan** — read-only inspection plus `plan_update`; creates or revises the authoritative structured plan.
- **read-only** — the same positive read-only tool allowlist and bash restrictions, without any plan tools or plan updates.
- **none** — restores the exact active-tool set captured before entering the restricted cycle. A preserved plan is shown as `none (plan paused)`, not as an active restriction.

Mode changes wait for Pi to be idle. Pressing `Ctrl+P` while an idle plan is executing pauses it, restores the planning model, then enters plan mode.

## Workflow

1. `/plan` enters structured planning. The agent investigates, asks focused questions when needed, then calls `plan_update` with a goal, top-level steps, verification criteria, follow-up work, and a required execution brief: summary, findings, decisions, relevant files with notes, and constraints. Legacy v2/v3 plans migrate with an empty brief and must be recalibrated before relying on inherited context.
2. A ready plan can be reviewed with `/plan-review`. The settings screen uses Up/Down to select a row; Tab/Right advances and Shift+Tab/Left reverses each multi-value row with wraparound. Enter/Space still advances, while Execute and Cancel remain explicit action rows.
3. Destinations are the current session, clipboard, a new parent-linked Pi session in the current tmux pane, a detached pane in the current tmux window, or a detached window in the current tmux session. The tmux rows appear only when the source pane resolves to both a session and window. Clipboard copies canonical plan Markdown and leaves the plan ready in plan mode.
4. Execution tracks each terminal step with `plan_step`; `plan_complete` records outcome, end state, verification, deviations, and next steps.

`/read-only` enters standalone inspection mode. `/mode` cycles the three access modes. `/plan-edit`, `/todos`, `/pause`, and `/plan-widget` retain their existing roles.

## Recalibration and interruption

After Pi settles from an interrupted execution, the existing resume, recalibrate, status-adjustment, and pause choices remain available. Kickoff, resume, and recalibration all use one canonical execution-context renderer, including the structured brief, step status, verification requirements, cwd, and source session identity. Recurring execution guidance is added to the per-turn system prompt rather than persisted as duplicate context messages. In the TUI recalibration editor, the configured `app.clipboard.pasteImage` binding (Ctrl+V by default) attaches a clipboard image and inserts a visible marker; when no image is available it pastes clipboard text. Image attachments are sent beside the canonical recalibration text. Escape cancels, Shift+Enter/Alt+Enter adds a line, and the configured external-editor binding (Ctrl+G by default) remains available. Recalibration restores plan restrictions and the planning model; a successful `plan_update` replaces the stale brief and resumes with the previously selected execution model.

## Execution models

The execution settings screen defaults to a new parent-linked Pi session in the current tmux pane. Model policy uses the current authenticated session model until a validated saved plan default exists, then offers that saved default initially. Detached panes default below the source and expose a per-launch Below/Right placement row; the row is hidden for every other destination. Outside tmux, the destination falls back to the current Pi session. The tmux-only current-pane destination replaces the session in the existing Pi process with an empty, parent-linked session and transfers only the canonical execution packet; it does not copy the planning transcript. It also offers current provider/model/thinking or a one-run provider/model/thinking choice. A separate `Save as plan default` toggle applies only to the chosen model. Clipboard hides irrelevant model controls and does not resolve or mutate model state.

The saved default is only `agent/plan-mode.json`'s `executionModel`; it never changes Pi's global `defaultProvider` or `defaultModel`. Temporary current-session switches use Pi's public model APIs so session history stays correct, then restore the global defaults through `SettingsManager`. A forced process kill between those operations is the narrow remaining window where Pi's global defaults can be left temporarily changed.

## Tmux handoff

Tmux is offered only inside a resolved tmux pane. Detached handoffs write a mode-`0600`, one-time file under `agent/plan-handoffs/`, then invoke detached `tmux new-window` or `tmux split-window` below/right of the source with argv and handoff/model environment variables only; plan text is never interpolated into shell source. Every spawned Pi command falls through to the pane's login shell after Pi exits, so its pane/window remains usable. Both preserve source cwd and focus. The source becomes handed-off only after a detached child consumes the packet and writes a bounded acknowledgement; launch or acknowledgement failure deletes stale packet files and leaves the source plan ready. The current-pane replacement follows the same private packet path through `/plan-review` in the fresh extension instance, which owns model/tool activation and kickoff safely after `newSession`.

## Configuration

`agent/plan-mode.json` stores the plan execution default:

```json
{
  "executionModel": {
    "provider": "ollama-cloud",
    "model": "glm-5.2",
    "thinkingLevel": "high"
  }
}
```

Unknown keys are preserved when the wizard saves a new execution default.

## Tests

```sh
cd ~/.config/pi-config/agent/extensions/plan-mode
node --experimental-strip-types --test *.test.ts
./tmux-handoff-smoke-test.sh
cd ../tmux && node --experimental-strip-types --test *.test.ts
```
