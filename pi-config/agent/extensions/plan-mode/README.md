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

1. `/plan` enters structured planning. The agent investigates, asks focused questions when needed, then calls `plan_update` with a goal, top-level steps, verification criteria, and follow-up work.
2. A ready plan can be reviewed with `/plan-review`. Execute opens one wizard: destination, then model policy.
3. Destinations are the current session, clipboard, or a new window in the current tmux session. Clipboard copies canonical plan Markdown and leaves the plan ready in plan mode.
4. Execution tracks each terminal step with `plan_step`; `plan_complete` records outcome, end state, verification, deviations, and next steps.

`/read-only` enters standalone inspection mode. `/mode` cycles the three access modes. `/plan-edit`, `/todos`, `/pause`, and `/plan-widget` retain their existing roles.

## Recalibration and interruption

After Pi settles from an interrupted execution, the existing resume, recalibrate, status-adjustment, and pause choices remain available. Recalibration restores plan restrictions and the planning model; a successful `plan_update` resumes with the previously selected execution model. Pi's normal retry lifecycle settles before this prompt is shown.

## Execution models

The execution wizard offers:

- current provider/model/thinking;
- the saved plan execution default;
- a one-run provider/model/thinking choice; or
- a choice saved as the plan execution default.

The saved default is only `agent/plan-mode.json`'s `executionModel`; it never changes Pi's global `defaultProvider` or `defaultModel`. Temporary current-session switches use Pi's public model APIs so session history stays correct, then restore the global defaults through `SettingsManager`. A forced process kill between those operations is the narrow remaining window where Pi's global defaults can be left temporarily changed.

## Tmux handoff

Tmux is offered only inside a tmux pane. The extension writes a mode-`0600`, one-time handoff file under `agent/plan-handoffs/`, then invokes `tmux new-window` with argv and environment variables only; plan text is never interpolated into shell source. The child validates and deletes the handoff before restoring the plan as executing.

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
```
