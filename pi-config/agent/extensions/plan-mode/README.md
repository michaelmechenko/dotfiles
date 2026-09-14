# Plan Mode Extension

Structured planning and sequential execution with direct file mutations disabled while planning or inspecting.

## Modes

`Ctrl+P` cycles without opening a dialog:

```
none → plan → read-only → none
```

- **plan** — preserves the active tool baseline except `write`, `edit`, and `apply_patch`, adds `plan_update`, and creates or revises the authoritative structured plan.
- **read-only** — preserves the same baseline except those direct mutation tools and all plan tools.
- **none** — restores the exact active-tool baseline captured before entering the restricted cycle. A preserved plan is shown as `none (plan paused)`, not as an active restriction.

Bash remains available in both restricted modes. Plan mode is not a shell sandbox: normal `permission-gate` and `protected-paths` safeguards remain independently active. Mode changes wait for Pi to be idle. Pressing `Ctrl+P` while an idle plan executes pauses it, restores the planning model, then enters plan mode.

## Workflow and history

1. `/plan` enters structured planning. The agent investigates, asks focused questions when needed, then calls `plan_update` with a goal, top-level steps, verification criteria, follow-up work, and a required execution brief.
2. A ready plan can be reviewed with `/plan-review`. The settings screen uses Up/Down to select a row; Tab/Right advances and Shift+Tab/Left reverses each multi-value row with wraparound. Enter/Space still advances, while Execute and Cancel remain explicit action rows.
3. Execution tracks terminal steps with `plan_step`; `plan_complete` records outcome, end state, verification, deviations, and next steps.
4. Each materialized plan receives a stable ID and creation timestamp. Only completed plans are archived, atomically, as individual private records under `agent/plan-history/<project-hash>/`; discarded plans are not retained. One session executes one plan at a time, then can start its next plan.

Project identity is the canonical Git common directory (so worktrees share history), or the canonical cwd outside Git. A scoped filesystem watcher updates a source session when a detached tmux execution archives its completed plan, releasing that source session for its next sequential plan.

`/read-only` enters standalone inspection mode. `/mode` cycles the three access modes. `/plan-edit`, `/todos`, `/pause`, and `/plan-widget` retain their existing roles.

## Recalibration and interruption

After Pi settles from an interrupted execution, the existing resume, recalibrate, status-adjustment, and pause choices remain available. Kickoff, resume, and recalibration use one canonical execution-context renderer, including the structured brief, step status, verification requirements, cwd, and source session identity. Recurring execution guidance is added to the per-turn system prompt rather than persisted as duplicate context messages.

Recalibration, pause, interrupted-execution shutdown, and the non-executing source side of acknowledged tmux handoff restore the planning model. Successful `plan_complete` deliberately leaves the selected execution model active, avoiding an immediate context-window downgrade.

## Execution models

The execution settings screen defaults to continuing in the current Pi session, including when that session is running in tmux. A valid, available saved plan default is selected before the current session model. When the **Model policy** row is selected, its detail line shows the saved provider, model, and thinking level. Missing, malformed, or unavailable saved defaults explicitly explain why the wizard falls back to the current model.

Detached panes default below the source and expose a per-launch Below/Right placement row; the row is hidden for every other destination. Tmux destinations remain explicit alternatives. The tmux-only current-pane destination replaces the session in the existing Pi process with an empty, parent-linked session and transfers only the canonical execution packet; it does not copy the planning transcript. A separate `Save as plan default` toggle applies only to a manually chosen model. Clipboard hides irrelevant model controls and does not resolve or mutate model state.

The saved default is only `agent/plan-mode.json`'s `executionModel`; it never changes Pi's global `defaultProvider` or `defaultModel`. Execution and planning model changes use Pi's session-local setters. Session start, resume, and branch navigation restore the selected branch's plan state, tool policy, and planning or execution model.

## Footer status

The footer's plan status is derived from the active plan and completed history for the current source session. Project storage remains shared across sessions and worktrees, but other sessions' completions do not affect this count:

- `waiting to plan`
- `1 plan · planning`, `1 plan · waiting to execute`, or `1 plan · paused`
- `plan <done>/<total>` while executing
- `1 plan · executing in handoff`
- `<N> plans executed · waiting for next plan`

## Tmux handoff

Tmux is offered only inside a resolved tmux pane. Detached handoffs write a mode-`0600` packet under `agent/plan-handoffs/`, then invoke detached `tmux new-window` or `tmux split-window` below/right of the source with argv and handoff/model environment variables only; plan text is never interpolated into shell source. Every spawned Pi command falls through to the pane's login shell on exit. The child atomically claims the durable packet, persists execution state, then acknowledges readiness. An unclaimed timeout leaves the source ready; a live claimed timeout leaves ownership with the child so the source cannot create a duplicate executor. The current-pane replacement uses the same claim path through `/plan-review` in the fresh extension instance.

Completed-plan archive retries compare stable plan and closeout content while retaining the first completion timestamp. Clipboard export includes the full execution brief as well as the plan and verification sections.

## Configuration

`agent/plan-mode.json` stores the plan execution default:

```json
{
  "executionModel": {
    "provider": "openai-codex",
    "model": "gpt-5.6-terra",
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
cd ../tool-toggle && node --experimental-strip-types --test *.test.ts
```
