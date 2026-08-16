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
2. A ready plan can be reviewed with `/plan-review`. Execute opens one settings screen; cycle values in place, then choose explicit Execute or Cancel rows.
3. Destinations are the current session, clipboard, a detached pane below the current pane in the current tmux window, or a detached window in the current tmux session. The tmux rows appear only when the source pane resolves to both a session and window. Clipboard copies canonical plan Markdown and leaves the plan ready in plan mode.
4. Execution tracks each terminal step with `plan_step`; `plan_complete` records outcome, end state, verification, deviations, and next steps.

`/read-only` enters standalone inspection mode. `/mode` cycles the three access modes. `/plan-edit`, `/todos`, `/pause`, and `/plan-widget` retain their existing roles.

## Recalibration and interruption

After Pi settles from an interrupted execution, the existing resume, recalibrate, status-adjustment, and pause choices remain available. Kickoff, resume, and recalibration all use one canonical execution-context renderer, including the structured brief, step status, verification requirements, cwd, and source session identity. Recurring execution guidance is added to the per-turn system prompt rather than persisted as duplicate context messages. Recalibration restores plan restrictions and the planning model; a successful `plan_update` replaces the stale brief and resumes with the previously selected execution model.

## Execution models

The execution settings screen defaults to a detached pane in the current tmux window and the saved plan execution default. Outside tmux, the destination falls back to the current Pi session. It also offers current provider/model/thinking or a one-run provider/model/thinking choice. A separate `Save as plan default` toggle applies only to the chosen model. Clipboard hides irrelevant model controls and does not resolve or mutate model state.

The saved default is only `agent/plan-mode.json`'s `executionModel`; it never changes Pi's global `defaultProvider` or `defaultModel`. Temporary current-session switches use Pi's public model APIs so session history stays correct, then restore the global defaults through `SettingsManager`. A forced process kill between those operations is the narrow remaining window where Pi's global defaults can be left temporarily changed.

## Tmux handoff

Tmux is offered only inside a resolved tmux pane. The extension writes a mode-`0600`, one-time handoff file under `agent/plan-handoffs/`, then invokes detached `tmux new-window` or detached vertical `tmux split-window` below the source pane with argv and handoff/model environment variables only; plan text is never interpolated into shell source. Both preserve the source cwd and leave the source pane/window selected. The source becomes handed-off only after the child consumes the packet and writes a bounded acknowledgement; launch or acknowledgement failure deletes stale packet files and leaves the source plan ready. A choose-and-save default is persisted only after current-session model activation or tmux acknowledgement succeeds.

## Parallel workstreams

`plan_update` optionally accepts 2–6 workstreams. Each declares a unique lowercase `id`, title, objective, assigned plan-step numbers, and owned relative paths. Workstreams must partition every top-level step exactly once and their paths must not overlap. Plan state v5 maps assigned display numbers to stable internal step IDs; a recalibration or manual edit clears mappings unless it supplies a complete rebuilt workstream declaration.

Parallel tmux execution creates one private packet and one detached, ownership-tagged window per stream in declaration order. Workers acknowledge startup first, then wait behind a shared release barrier. A failed launch removes packets and closes only exact tagged unreleased panes; released workers are never automatically terminated. Each worker writes an atomic closeout report. The source plan records the durable run reference and reconciles report availability on restart; the coordinator remains responsible for final cross-workstream verification and `plan_complete`.

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
