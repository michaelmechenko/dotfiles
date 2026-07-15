# pi-goal

Codex-style long-running goal mode for [pi](https://github.com/earendil-works/pi). Start one explicit objective, let the main agent keep working across turns, and automatically hand off to a linked new session when context reaches the budget limit.

## Install

```bash
pi install npm:@ogulcancelik/pi-goal
```

Or add manually to `~/.pi/agent/settings.json`:

```json
{
  "packages": ["npm:@ogulcancelik/pi-goal"]
}
```

## Usage

```text
/goal implement the migration and verify tests
```

`/goal <objective>` starts an active goal and queues hidden continuation messages after each completed agent cycle until the model calls `update_goal({ status: "complete" })`.

Controls:

```text
/goal          show current goal summary
/goal pause    pause automatic continuation
/goal resume   resume and recapture handoff control
/goal handoff  ask the agent to prepare a handoff now
/goal clear    clear the current goal
```

## Behavior

pi-goal keeps state append-only in the current session with `pi-goal:state` custom entries. It does not write `.pi/goals`, spawn worker agents, mutate the system prompt, patch provider payloads, or rewrite prior history.

At 95% context usage, pi-goal marks the goal budget-limited and asks the model to call `goal_handoff({ prompt })`. The extension then starts a linked new session with `parentSession` metadata and sends the self-contained handoff prompt as the first user message.

## Tools

| Tool | Purpose |
|------|---------|
| `get_goal` | Inspect current goal state, context usage, and lineage |
| `create_goal` | Compatibility path for model-created goals; `/goal <objective>` is preferred |
| `update_goal` | Complete the goal; only accepts `status: "complete"` |
| `goal_handoff` | Capture a self-contained prompt and continue in a linked new session |

## License

MIT
