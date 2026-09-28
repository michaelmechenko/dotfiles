# Subagent

A bounded, foreground delegation tool for isolated pi subprocesses. It retains the existing single, parallel, and chain contracts; it does not manage background jobs, durable agent state, worktrees, or nested orchestration.

## Behavior

- Runs every agent in a fresh `pi --mode json --no-session` subprocess.
- Uses the parent model and thinking level for agents without a pinned `model`; pinned agents keep their own model.
- Delivers the task and agent system prompt through a mode-0600 temporary directory, never as raw task text in argv. Files are removed when the run settles, aborts, times out, or fails to spawn.
- Accepts YAML `tools` frontmatter as either `read, bash` or `[read, bash]`. An omitted policy inherits the parent; `tools: []` grants no tools; malformed policies are reported without hiding valid sibling agents.
- Intersects every agent policy with the parent's active tools and always removes recursive delegation and parent-owned plan lifecycle tools. Restricted parents cannot regain mutation tools through any agent, including `researcher`.
- Requires exactly one nonempty mode. Parallel and chain calls are capped at 8 items. One FIFO limiter caps all sibling single/parallel/chain tool calls in the extension session at 4 running children total; queued work observes cancellation.
- Keeps 1 MiB as the in-memory JSONL threshold, spills larger records to a mode-0600 private temp file, accepts valid records up to 16 MiB, and projects aggregate `agent_end` records to terminal metadata instead of retaining duplicated message histories. Rejections identify malformed versus oversized records with bounded record-number/byte-count metadata and never include payload text.
- Bounds stderr (32 KiB), projected retained messages (16 messages and 32 KiB total), task text in details (4 KiB), and recent activity (8 items), and requires exactly one final documented `agent_end` event (while accepting Pi's optional trailing `agent_settled`).
- Enforces a 30-minute runtime limit. Abort and timeout terminate the owned child process group, then escalate after five seconds if needed.
- Keeps `tool-display/` and Pi's default tool shell as the sole frame. This extension has no renderer or widget.

## Foreground progress

`onUpdate.content` is throttled and deduplicated. The default tool shell receives concise state text before the child finishes a message:

- single: agent state, active tool, retry, turns/tokens, elapsed time, recent activity
- chain: the active `Step n/N` with the same state
- parallel: one independently updated `Lane n/N` per task

The reducer consumes `tool_execution_start/update/end`, `message_update`, `message_end`, `agent_end`, `auto_retry_start/end`, and `agent_settled`. A child is not marked completed merely because a turn ended while a retry is pending.

## Tool modes

| Mode     | Parameters                     | Behavior                                                 |
| -------- | ------------------------------ | -------------------------------------------------------- |
| Single   | `{ agent, task }`              | One isolated agent                                       |
| Parallel | `{ tasks: [{ agent, task }] }` | Up to 8 tasks, 4 concurrent                              |
| Chain    | `{ chain: [{ agent, task }] }` | Sequential; `{previous}` receives the prior final output |

Single and chain outputs use a 50 KiB model-visible budget. Parallel calls share a 100 KiB total budget (with a per-child slice no larger than 50 KiB), so eight children cannot produce an unbounded aggregate. Chain handoff uses the same 50 KiB policy. When an accepted final answer exceeds its visible budget, the full text is retained under `$XDG_STATE_HOME/pi/subagent-results/` (fallback `~/.local/state/pi/subagent-results/`) in a mode-0600 file and the real path is returned. The mode-0700 artifact directory retains at most 64 files for 7 days. Failures report the shortest useful spawn, timeout, abort, stderr, or final-message diagnostic.

## Agents

User agents live in `~/.config/pi-config/agent/agents/*.md`. Project agents in `.pi/agents/*.md` load only when a call sets `agentScope: "project"` or `"both"`. They require interactive approval by default; headless use must explicitly set `confirmProjectAgents: false` after independent trust.

Use `researcher` for deep primary-source research, `scout` for compact read-only recon, `reviewer` for adversarial review, and `worker` for bounded implementation. Give every delegation an objective, scope, deliverable, constraints, and verification. The parent owns integration decisions; one writer owns a checkout at a time.

## Local verification

```bash
node --experimental-strip-types --test pi-config/agent/extensions/subagent/*.test.ts
PI_CODING_AGENT_DIR="$PWD/pi-config/agent" pi --no-extensions -e "$PWD/pi-config/agent/extensions/subagent/index.ts" --help
```

The test suite uses only Node primitives and does not make model calls.
