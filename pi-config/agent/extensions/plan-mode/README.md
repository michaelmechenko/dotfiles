# Plan Mode Extension

Structured planning and sequential execution with direct file mutations disabled while planning or inspecting.

## Modes

`Ctrl+P` cycles without opening a dialog:

```
none → plan → read-only → none
```

- **plan** — preserves the active tool baseline except `write`, `edit`, and `apply_patch`, adds `plan_update`, and creates or revises the authoritative tracked plan.
- **read-only** — preserves the same baseline except direct mutation and tracked-execution tools. `plan_update` remains available for internal agent planning only.
- **none** — restores the exact active-tool baseline captured before entering the restricted cycle. A preserved plan is shown as `none (plan paused)`, not as an active restriction; `plan_update` remains available when the user has not disabled it.

Bash remains available in both restricted modes. Plan mode is not a shell sandbox; project trust and the mode's active-tool restrictions remain independent boundaries. Mode changes and state-changing plan commands wait for Pi to be idle. Entering either restricted mode during execution first pauses it and restores the planning model. A handed-off plan cannot be paused, edited, discarded, or executed in its source session. If a restored child claim is invalid, the child becomes inspection-only with visible ownership-recovery attention: it retains the claim reference, removes execution tools, and accepts neither tracked updates nor control/resume kickoff. Only the original source session may explicitly recover a verified-dead detached handoff.

## Internal and tracked plans

`plan_update` accepts an optional `scope`. Tracked `steps` accept legacy strings or `{ id?, text }` entries. Existing IDs preserve terminal status across renames and reordering; a missing ID creates pending work. Unknown or duplicate tracked IDs reject the whole update. IDs appear in the plan, execution context, live export, and clipboard; internal plans accept only string steps.

- `internal` replaces an agent-only coordination plan. It works in every access mode and tracked-plan phase, is restored branch-locally from the tool result, and never changes tracked state, plan files/history, models, footer/widgets, review dialogs, or execution handoffs.
- `tracked` revises the authoritative execution plan and is accepted only in explicit plan mode or active tracked execution. Read-only mode rejects it.
- An omitted scope selects `tracked` only in explicit plan mode or active tracked execution. It selects `internal` everywhere else, including read-only mode.

Internal plans remain ordinary session tool-result data; “internal” means outside the tracked workflow, not absent from the transcript. They have no promotion action, execution engine, history archive, or separate UI. `plan_step` and `plan_complete` remain tracked-execution-only. A user-disabled `plan_update` remains disabled.

## Workflow and history

1. `/plan` enters structured tracked planning. The agent investigates, asks focused questions when needed, then calls `plan_update` with a goal, top-level steps, verification criteria, follow-up work, and a required execution brief.
2. A ready plan can be reviewed with `/plan-review`. The settings screen uses Up/Down to select a row; Tab/Right advances and Shift+Tab/Left reverses each multi-value row with wraparound. Enter/Space still advances, while Execute and Cancel remain explicit action rows.
3. Execution tracks terminal steps with `plan_step`; `plan_complete` records outcome, end state, verification, deviations, and next steps.
4. Each materialized plan receives a stable ID and creation timestamp. Only completed plans are archived, atomically, as individual private records under `agent/plan-history/<project-hash>/`; discarded plans are not retained. One session executes one plan at a time, then can start its next plan.

Project identity is the canonical Git common directory (so worktrees share history), or the canonical cwd outside Git. A scoped filesystem watcher updates a source session when a detached tmux execution archives its completed plan, releasing that source session for its next sequential plan. If the owner exits without archiving, `/plan-recover` can explicitly reclaim a process-instance-verified dead handoff after a confirmation; the user must inspect any work the child may have performed. Claims carry process-instance identity, a unique token, source, and plan identity. Recovery state is persisted in the paused plan and cleanup requires its exact owner token. A confirmed recovery can replace only a verified-dead recovery claimant; live or unverifiable owners cannot be reclaimed. Recovery successors use immutable predecessor-linked claims; terminal recovery records and cancellation claims remain as small durable fences against delayed consumers. Historical renamed `.reclaiming` packets remain explicitly recoverable.

`/read-only` enters standalone inspection mode. `/mode` cycles the three access modes. `/plan-edit`, `/todos`, `/pause`, and `/plan-widget` retain their existing roles.

## Recalibration and interruption

After Pi settles from an interrupted execution, the existing resume, recalibrate, status-adjustment, and pause choices remain available. Kickoff, resume, and recalibration use one canonical execution-context renderer, including the structured brief, step status, verification requirements, cwd, and source session identity. Recurring execution guidance is added to the per-turn system prompt rather than persisted as duplicate context messages.

Recalibration, pause, interrupted-execution shutdown, and the non-executing source side of acknowledged tmux handoff restore the planning model. Successful `plan_complete` deliberately leaves the selected execution model active, avoiding an immediate context-window downgrade.

## Execution models

The execution settings screen defaults to continuing in the current Pi session, including when that session is running in tmux. A valid, available saved plan default is selected before the current session model. When the **Model policy** row is selected, its detail line shows the saved provider, model, and thinking level. Missing, malformed, or unavailable saved defaults explicitly explain why the wizard falls back to the current model.

Detached panes default below the source and expose a per-launch Below/Right placement row; the row is hidden for every other destination. Tmux destinations remain explicit alternatives. The tmux-only current-pane destination persists an exact transfer record (packet path, transfer ID, plan/source identity, and save-default choice) before queuing `/plan-review`, then replaces the session in the existing Pi process with an empty, parent-linked session and transfers only the canonical execution packet; it does not copy the planning transcript. Detached pane/window launches likewise persist a typed source-bound intent (packet/plan/source/branch, destination, and tmux launch target) and mark the plan handed off **before** awaiting tmux. Errors, timeouts, navigation, reload, and shutdown retain that fence; an unclaimed detached packet returns to ready state only after an explicit `/plan-review` cancellation in the exact source branch. Reload, cancellation, and failed replacement never create a second executor. A separate `Save as plan default` toggle applies only to a manually chosen model. Clipboard hides irrelevant model controls and does not resolve or mutate model state.

The saved default is only `agent/plan-mode.json`'s `executionModel`; it never changes Pi's global `defaultProvider` or `defaultModel`. Execution and planning model changes use Pi's session-local setters. Session start, resume, and branch navigation restore the selected branch's plan state, tool policy, and planning or execution model. Model effects are ordered by destination: a stale authenticated `setModel` mutation is repaired to the latest branch's explicit plan model or independently captured native model/thinking state, including planless branches; failed authentication does not retry in a loop or override a later user model selection.

## Footer status

The footer's plan status is derived from the active plan and completed history for the current source session. Project storage remains shared across sessions and worktrees, but other sessions' completions do not affect this count:

- `waiting to plan`
- `1 plan · planning`, `1 plan · waiting to execute`, or `1 plan · paused`
- `plan <done>/<total>` while executing; closeout attention adds a widget directing the user to `/plan-review`
- `1 plan · executing in handoff`
- `<N> plans executed · waiting for next plan`

## Tmux handoff

Tmux is offered only inside a resolved tmux pane. Detached handoffs write a mode-`0600` packet under `agent/plan-handoffs/`, then invoke detached `tmux new-window` or `tmux split-window` below/right of the source with argv and handoff/model environment variables only; plan text is never interpolated into shell source. Every spawned Pi command falls through to the pane's login shell on exit. The child atomically claims the durable packet with PID and OS process-start identity, persists execution state, then acknowledges readiness. The source records its detached launch intent before waiting; both unclaimed and claimed timeouts retain ownership until the original source explicitly cancels an unclaimed packet or recovers a verified-dead child. Late acknowledgements remain inspectable until the completed archive releases the source. No automatic takeover of unarchived child work occurs. The current-pane replacement uses the same claim path through `/plan-review` in the fresh extension instance.

Current v7 restores validate unique nonempty step IDs, canonical positive step numbers, and mutually exclusive terminal flags. A v6 upgrade preserves trusted unique IDs and terminal status while canonicalizing its display numbering; malformed v6 tracked state is refused into ownership attention rather than falling back to checklist sidecars. v2–v5 records receive deterministic `legacy-N` IDs and canonical numbering. Completed-plan archive retries compare stable plan and closeout content while retaining the first completion timestamp. Terminal progress uses execution-identity- and epoch-bound closeout state: `agent_before_settle` requests at most one automatic `plan_complete` turn for a completed, continuable execution. Abort, a non-continuable/pending boundary, archive failure, reload, or a missing completion becomes recoverable attention rather than looping; retry explicitly through `/plan-review`. Pause prevents automatic continuation. Each explicit retry authorizes one attempt, not another automatic rescue turn. Clipboard export includes the full execution brief as well as the plan and verification sections.

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
