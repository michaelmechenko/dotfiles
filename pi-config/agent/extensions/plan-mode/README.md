# Plan Mode Extension

A read-only planning workflow with structured plan revisions, tracked execution, and a required closeout.

## Workflow

1. `/plan` enters read-only planning. The agent investigates, asks contextual clarifying questions when needed, then calls `plan_update` with a goal, top-level steps, verification criteria, and follow-up work.
2. The plan review dialog lets you execute, recalibrate, or keep planning.
3. Execution switches to the configured execution model, currently `opencode/gpt-5.6-luna` at medium thinking. The planning model and the exact active-tool set are restored when the workflow pauses or completes.
4. The agent calls `plan_step` immediately after each completed or skipped step. If scope changes or a blocker invalidates pending work, it calls `plan_update` again rather than requiring a new `/plan` cycle.
5. After every step is terminal, the agent must call `plan_complete`. Its closeout records the goal, outcome, end state, verification, deviations, and next steps.

## Recalibration and interruption

Pressing Escape uses Pi's normal abort behavior. Once the agent has settled, plan mode shows the interrupted step and offers:

- resume the current step;
- recalibrate from the current state;
- adjust statuses in `/todos`; or
- pause the plan.

Recalibration opens an editor for the requested change, restores read-only planning and the planning model, then resumes execution automatically after the agent calls `plan_update`.

Pi already retries retryable 5xx and connection failures. Plan mode waits for Pi's retry lifecycle to settle before it shows an interruption dialog, so a `503` or `Connection error.` does not prematurely stop execution. Account, quota, and billing failures remain terminal.

## Commands

- `/plan` — start planning, or pause an active workflow.
- `/plan-review` — execute, recalibrate, edit, pause, or discard the active plan.
- `/plan-edit` — manually edit top-level steps.
- `/plan-widget` — toggle compact/full progress.
- `/todos` — inspect or correct step statuses.
- `/pause` — pause execution.
- `Ctrl+P` — enter plan mode when inactive; otherwise open the active plan workflow.
- `Ctrl+Alt+P` or `Ctrl+Alt+T` — toggle compact/full progress.

## Configuration

`~/.config/pi-config/agent/plan-mode.json` configures the execution model:

```json
{
  "executionModel": {
    "provider": "opencode",
    "model": "gpt-5.6-luna",
    "thinkingLevel": "medium"
  }
}
```

If the configured model is unavailable or unauthenticated, plan mode warns and continues with the current model. Pi's public `setModel()` also updates its global default model; normal pause/completion/shutdown restores the saved planning model, but a forced process kill can leave the execution model selected.

## Read-only mode

Planning and recalibration use a positive allowlist of read-only tools plus `plan_update`, rather than only disabling `edit` and `write`. Bash is additionally restricted to read-only commands.
