# tmux extension

Foreground Pi control for detached, tmux-owned shell jobs. Public actions remain `run`, `attach`, `peek`, `list`, and `mute`; `/tmux:fork` is separate session branching. The extension never kills or deletes a tmux pane, window, or session.

## Managed jobs

New version-2 records under `$PI_CODING_AGENT_DIR/tmux-jobs/` include the originating Pi session ID, launch-branch leaf, tmux socket, and tmux session. Access from a descendant branch requires all owner fields to match. Legacy version-1 records remain listable as unowned metadata but cannot auto-notify or capture a pane whose server identity is unknown.

The command still runs on a tmux PTY. A start gate installs `pipe-pane` first, then a private Node logger writes chunks immediately to `<job>.log` without changing the command's stdout/stderr type. Each mode-0600 log is capped at 64 MiB; the logger continues draining after the cap so the job never receives a closed output pipe. Logs and records are retained until a separate cleanup policy is designed.

`peek` and `/tmux:cat` read the retained log rather than pane history. Model-visible output is sanitized and capped at 2,000 lines / 50 KiB; the real retained path is returned.

## Completion and inactivity

An `fs.watch` observer is installed before startup reconciliation. Events are coalesced into scans of durable `.done` and `.log.done` markers; filenames from watcher callbacks are never trusted. Watcher failures are reported, reconciled, rebound, and reconciled again. Startup and every tool boundary remain recovery scans. There is no pane polling.

Completion state stays in the job JSON. Delivery claims and acknowledgements are separate SQLite transactions so concurrent processes resumed on the same Pi branch cannot both claim the event. The claimed summary remains extension-local until `before_agent_start` injects it into the next user turn; acknowledgement follows at `agent_start`, after Pi accepts the persistent message. Muting before that turn suppresses and acknowledges the queued event. Session replacement or shutdown releases an unconsumed claim. This gives durable ordinary restart delivery without claiming crash-proof exactly-once delivery across Pi's in-memory event boundary.

Silence deadlines use retained-log mtime, not launch time. Output moves the deadline and clears a prior silence notice, allowing a later inactivity interval to notify once again.

## Verification

```sh
node --experimental-strip-types --test pi-config/agent/extensions/tmux/*.test.ts
PI_CODING_AGENT_DIR="$PWD/pi-config/agent" pi --no-extensions -e "$PWD/pi-config/agent/extensions/tmux/index.ts" --help
```

Integration verification should use a fresh `tmux -L <socket> -f /dev/null` server with a self-expiring origin session. Register the watcher before launch, run a command with separated short writes and a nonzero exit, verify the pane disappears while the retained log remains readable, acknowledge the stable event, rescan the stale marker, and verify a silence deadline moves after output.
