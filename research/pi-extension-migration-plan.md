# Pi extension migration: review and implementation plan

Status: implemented. The reviewed forks were published, the Lens/BTW Nix closure was activated, live Pi settings/package state was migrated with a rollback backup, and the feature branch was merged into `main`. The combined post-merge closure has been built but intentionally not activated.

## Implementation outcome

- Lens fork: `michaelmechenko/pi-lens@5e27080a3855dba5a2263f7e3b043e8d7385c3a5`.
- BTW fork: `michaelmechenko/pi-btw@3241ec5f541367e17bff3d5ccf0c9cbca71a04ea`.
- Dotfiles feature commits: `28bf0b0` (Lens/BTW migration), `1d180cf` (subagent transport), and `64c0d1d` (durable tmux completion), merged into `main` by `729a86b` after the existing agent-action work was committed as `7e84238`.
- Live Pi resolves store-backed Lens and BTW with package skills disabled, retains `pi-ast-grep` and `pi-mcp-adapter`, and no longer loads pi-lsp, lsp-startup, protected-paths, or permission-gate. The pre-migration public settings/npm workspace is retained at `~/.local/state/pi-migrations/20260928T145812Z`.
- Final integration verification passed 45 plan-mode tests, 32 subagent/tmux tests, all focused tmux/nnn protocol tests, `go test -race ./...` for mm-sidebar, the Pi configuration audit, syntax checks, and a full NixOS closure build at `/nix/store/fsd64gr37xnj3dsd2050s0jnfgz6dnnh-nixos-system-nixos-26.05.20260921.1e8bc65`.
- `tmux-status-render-test.py` still has its pre-existing blank-stripe mismatch and remains outside this migration. The unrelated deletion of `pi-config/agent/models.json` also remains deliberately unresolved.

The sections below preserve the source-linked review and rationale that led to the implementation.

## Decisions

1. Create upstream-tracking **GitHub forks** of `apmantza/pi-lens` and `dbachelder/pi-btw` under `michaelmechenko`, the authenticated account. Install tested fork revisions, not floating upstream HEAD.
2. Replace `@dreki-gg/pi-lsp` with Lens and remove its integration/configuration leftovers.
3. Remove **both `protected-paths` and `permission-gate`**, as explicitly requested during review. Do not recreate their prompts/path blockers in another extension.
4. Keep the existing `tmux` and `subagent` extensions. Improve their concrete reliability/observability gaps; do not install `pi-background-tasks` or either upstream `pi-subagents` wholesale.
5. Preserve plan/read-only mode, project trust, parent tool selection, and the one-writer-per-checkout convention. Removing the two protection extensions does not imply removing those independent workflows.

BTW assumption: retain upstream coding, contextual, tangent, and read-only modes rather than converting the entire extension to read-only. Recommend `/btw:ask` while the main agent edits the same checkout, then `/btw:inject` or `/btw:summarize` for handoff. No new global writer-lock service is proposed.

## Current configuration and verification

The active machine is Linux/NixOS, x86_64, Hyprland/Wayland, running Pi **0.86.1**. `PI_CODING_AGENT_DIR` is `~/.config/pi-config/agent`.

| Area | Inspected state | Migration consequence |
|---|---|---|
| Extension deployment | `nix/home/pi.nix` deploys extensions from `nix/packages/pi-extensions.nix` into the Nix store | Editing checkout extension files and `/reload` alone does not deploy them here |
| Mutable settings | Home Manager seeds settings/keybindings/npm state only when absent | Updating Nix defaults will not remove the existing live pi-lsp installation or filters |
| Packages | Tracked: pi-lsp, pi-ast-grep, pi-mcp-adapter; Linux pins 0.5.2, 0.1.0, 2.36.0 | Remove pi-lsp from tracked settings, Linux seeds, runtime lockfile, and live settings/package state |
| LSP | TypeScript, Pyright, Bash enabled; Rust, Go, Lua disabled | Preserve these choices initially instead of enabling Lens's entire server inventory |
| LSP startup | Local `lsp-startup` inspects pi-lsp's particular config/root semantics | Retire this code/filter; use Lens's own health/status reporting |
| Protections | `protected-paths` active; `permission-gate` already disabled in tracked and live settings | Remove both sources and obsolete audit assertions, not merely add more negative filters |
| Delegation | Fresh foreground subprocesses; single/parallel/chain; parent-tool intersection; no recursion/child plan ownership | Keep this public contract and strengthen transport/results before adding features |
| Background commands | Tmux-owned jobs with private command/done records; run/attach/peek/list/mute | Improve this manager rather than adding a competing shell runtime |

Verification performed during review:

- `node --experimental-strip-types --no-warnings --test agent/extensions/subagent/*.test.ts agent/extensions/tmux/*.test.ts agent/extensions/plan-mode/restricted-mode.test.ts`: **24 passed**.
- `node check.mjs`: two existing failures — it requires the disabled permission-gate, and README's default model differs from tracked settings. The removal resolves the first; update documentation for the second without changing the selected model.
- Live default model also differs from tracked settings. Preserve the live model and unrelated preferences during migration.
- Two research children wrote their briefs, but their tool invocations failed with `Subagent emitted 1 malformed or oversized JSONL record(s).` The actual rejected records were not retained, so their precise cause is not proven.
- A synthetic, valid `agent_end` JSON event containing twenty 60 KB tool results is **1,201,234 bytes**, and the current decoder rejects it at its **1 MiB** record cap. Pi's documented `agent_end.messages` aggregates the run's messages; this is a concrete failure mode to fix, not a reason to discard all protocol validation.

Unrelated dirty files appeared during review, including the pre-existing deletion of `pi-config/agent/models.json` and concurrent terminal/tmux edits. They are outside this plan.

## Upstream assessment

### Lens: adopt through a small fork, not as an unchanged LSP replacement

Reviewed commit: [`feae3cf1486901ce3e9c3a8b2fbff122fe5e59c4`](https://github.com/apmantza/pi-lens/tree/feae3cf1486901ce3e9c3a8b2fbff122fe5e59c4), package version 4.3.0, MIT.

Lens adds useful navigation, diagnostics, identifier search, module outlines, and symbol-scoped reading. It also adds automatic formatting/fixes, edit/commit guards, scanners, context injection, caches, lazy tool activation, and runtime installers. This is a considerably larger integration than pi-lsp.

Important source findings:

- Its optional TUI peer range is `^0.84.1 || ^0.85.0`, excluding this host's 0.86.1. This is a **compatibility-validation gate**, not proof that it fails at runtime. Test against the actual host and update the fork's peer contract only after verification.
- Git installation invokes a `prepare` script that builds, downloads grammars, configures Git hooks, and warms a loader cache. The existing generic Nix extension helper skips scripts and builds; it cannot package this source unchanged. Build deliberately and fetch grammar assets with fixed hashes; do not execute the entire prepare script in deployment.
- Upstream already provides `PI_LENS_DISABLE_LSP_INSTALL=1` and `PI_LENS_DISABLE_TOOL_INSTALL=1`. Use them on NixOS before inventing a custom installer patch; test missing-tool behavior and grammar acquisition separately.
- `PI_LENS_CONFIG_PATH` gives an unambiguous config location. The fallback `$PI_CODING_AGENT_DIR/extensions/pi-lens.json` loses to an existing legacy `~/.pi-lens/config.json`, so an explicit path avoids silently using the wrong config. The deployed source is named `pi-lens-global.json`: using Lens's reserved undotted `pi-lens.json` basename inside this repository makes it look like deprecated project config whenever the repository itself is the workspace.
- The new LSP config uses `lsp.servers`, `lsp.serverOverrides`, and `lsp.disabledServers`, not pi-lsp's `lsp.<name>.command[]`. Custom servers use a command string plus `args`. Translate deliberately and verify actual built-in IDs rather than assuming old names match.
- `lsp_navigation` includes both inspection and mutation-capable operations; `lens_diagnostic_mark` can write suppression comments; `ast_grep_replace` mutates files. Lazy activation can change the parent's active tool list. These require integration with the retained plan/tool policy, even after the protection extensions are removed.
- Global format/autofix defaults can be overridden by project configuration. A global `false` alone is not an enforcement mechanism for plan/read-only mode.

Recommended initial profile:

- Enable navigation, LSP diagnostics, and lightweight project-intelligence tools.
- Preserve the currently enabled language set and use Nix-provisioned binaries. Explicitly disable other bundled servers at the pinned revision if necessary to preserve that set.
- Disable read-before-edit and commit/push guards. Do not replace the removed protection extensions with Lens blockers.
- Start with automatic format/autofix, startup scans, automatic tests, and heavy analyzers off. Keep explicit diagnostics available. Enable additional automation later based on observed value/latency, not upstream defaults.
- Keep the existing quiet footer/tool presentation; avoid adding permanent widget clutter. Use existing theme roles.
- Keep `pi-ast-grep` initially. Disable redundant Lens AST tools if appropriate; removing the existing package requires an explicit parity decision and is not part of the pi-lsp replacement.
- Prefer static activation of the selected Lens tools (`tools.lazy=false`) for predictable tool-toggle/subagent behavior; still test its registered loader cannot re-enable tools forbidden by the parent's current policy.

Sources: [manifest/build](https://github.com/apmantza/pi-lens/blob/feae3cf1486901ce3e9c3a8b2fbff122fe5e59c4/package.json), [tools](https://github.com/apmantza/pi-lens/blob/feae3cf1486901ce3e9c3a8b2fbff122fe5e59c4/docs/agent-tools.md), [configuration](https://github.com/apmantza/pi-lens/blob/feae3cf1486901ce3e9c3a8b2fbff122fe5e59c4/docs/globalconfig.md), [environment/install controls](https://github.com/apmantza/pi-lens/blob/feae3cf1486901ce3e9c3a8b2fbff122fe5e59c4/docs/environment-variables.md), [LSP config source](https://github.com/apmantza/pi-lens/blob/feae3cf1486901ce3e9c3a8b2fbff122fe5e59c4/clients/lsp/config.ts).

### BTW: adopt; keep its side-conversation purpose

Reviewed commit: [`cf71cdee7d43551d569cb990f95b020dc401a293`](https://github.com/dbachelder/pi-btw/tree/cf71cdee7d43551d569cb990f95b020dc401a293), v0.6.1, MIT.

Useful upstream behavior:

- `/btw` and `/side` open a continuous side conversation without interrupting the parent.
- `/btw:tangent` omits parent conversation context; `/btw:ask` is structurally read-only.
- `/btw:inject` and `/btw:summarize` explicitly hand results to the parent, queued as a follow-up while it is busy.
- Model/thinking overrides affect only the side session; overlay state is restored from session entries.

Integration issues:

- Declared peers include 0.86.1, but v0.6.1 was developed against newer Pi and changed context seeding for 0.87+. Validate the actual 0.86.1 SDK/session behavior; do not infer it solely from the version range.
- Its child resource loader intentionally omits extensions/skills/context files and exposes built-in tools. It will not automatically inherit plan-mode, tool-toggle, diff's execution behavior, Lens, or image-proxy. Do not load the entire global extension stack into an in-process side session; that risks duplicate UI hooks and shared session registries.
- Remove the two protection extensions as requested; no guard transplant is needed. Separately make the side session respect the parent's selected tool ceiling and retained plan/read-only mode. Re-evaluate on subsequent prompts/mode changes rather than freezing permissions at first creation.
- Hidden BTW entries are **persisted in the ordinary session file** and excluded from the main model's future context. They are not ephemeral or encrypted. A contextual side thread sends parent context to its effective model; an override can therefore change the recipient provider.
- Concurrent coding is still concurrent coding. Keep one writer per checkout by usage: `/btw:ask` during parent implementation, then explicit handoff. Do not claim that a per-file mutation queue makes two independent coding plans safe.
- Upstream `Alt+w` overlay resize conflicts with the existing tmux root `M-w` window picker. Preserve the tmux binding and remap BTW's resize key in the fork; validate actual terminal delivery. Focus defaults (`Alt+/`, `Super+/`, `Ctrl+Alt+W`) need Ghostty/Hyprland/tmux checks as well.

Install the extension only initially; do not automatically import its optional skill. Keep the fork delta limited to compatibility, parent-tool integration, shortcut adaptation, and existing UI conventions.

Sources: [README](https://github.com/dbachelder/pi-btw/blob/cf71cdee7d43551d569cb990f95b020dc401a293/README.md), [implementation](https://github.com/dbachelder/pi-btw/blob/cf71cdee7d43551d569cb990f95b020dc401a293/extensions/btw.ts), [manifest](https://github.com/dbachelder/pi-btw/blob/cf71cdee7d43551d569cb990f95b020dc401a293/package.json).

### pi-background-tasks: do not install alongside tmux

Reviewed commit: [`471f1dcae7ff13d8f989e4c056bdff1e6b01f1ef`](https://github.com/ismailsaleekh/pi-background-tasks/tree/471f1dcae7ff13d8f989e4c056bdff1e6b01f1ef), v2.6.8, ISC.

It is a separate shell process manager, not a tmux adapter. Its useful pieces are persistent logs, bounded output reads, explicit task/result identities, completion delivery, and owned-process cancellation. However:

- It normally cancels tasks on shutdown and does not recover them after Pi restart/crash. Opt-in survival is limited to particular shell tasks across same-process reload.
- `bg_delegate` is a separate read-only child workflow, not the local write-capable researcher/worker model. Its default isolated tools cannot perform the researcher's web investigation and write the requested brief.
- It adds separate tools/UI plus Fusion multi-agent evaluation and an Anthropic attribution/provider feature enabled by default. Those are unrelated to the present request.
- It has no Worktrunk/worktree ownership model. Its declared Pi peer ranges also exclude 0.86.1, despite a newer-version testing claim in its commit history.

**Case for adoption:** a non-tmux environment wanting disposable session-scoped shell tasks, the package's deliberately read-only delegates, or its full Fusion workflow. In that case, configure and test it as the chosen manager rather than stacking it over the existing one. Those needs are not established here.

**Useful ideas to transfer:** log artifacts independent of pane lifetime, event-driven completion delivery, explicit task ownership, and bounded result retrieval. Preserve tmux's existing no-pane/window/session-deletion contract.

Sources: [runtime contract](https://github.com/ismailsaleekh/pi-background-tasks/blob/471f1dcae7ff13d8f989e4c056bdff1e6b01f1ef/docs/subsystems/background-task-runtime.md), [registry](https://github.com/ismailsaleekh/pi-background-tasks/blob/471f1dcae7ff13d8f989e4c056bdff1e6b01f1ef/src/core/registry.ts), [delegation](https://github.com/ismailsaleekh/pi-background-tasks/blob/471f1dcae7ff13d8f989e4c056bdff1e6b01f1ef/docs/tools/bg_delegate.md), [configuration](https://github.com/ismailsaleekh/pi-background-tasks/blob/471f1dcae7ff13d8f989e4c056bdff1e6b01f1ef/docs/operations/configuration.md), [manifest](https://github.com/ismailsaleekh/pi-background-tasks/blob/471f1dcae7ff13d8f989e4c056bdff1e6b01f1ef/package.json).

### Both pi-subagents projects: references, not drop-in replacements

| Project | Valuable capabilities | Why not replace the local implementation now |
|---|---|---|
| [nicobailon](https://github.com/nicobailon/pi-subagents/tree/c8dd65564c7e7f0cef735f0e7a1577f2f72b674a), `c8dd655…`, v0.73.1, MIT | Durable async results, resumable sessions with leases, resource budgets, steer/interrupt/stop, context modes, workflows; CI includes Pi 0.86.1 | Much broader orchestration product. Adopting it requires decisions on persistence, authority, context transfer, UI, and Nix launch behavior—not just replacing a tool |
| [tintinweb](https://github.com/tintinweb/pi-subagents/tree/e955e29c51b7a6cce37e1108cd2d6c57a77e151c), `e955e29…`, v0.19.0, MIT | Background queues, persistent agent handles, live inspection/steering, resume, optional inherited context | Different capability model; foreground concurrency is unlimited by default. Its automatic worktree cleanup stages all changes, commits with `--no-verify`, and force-removes worktrees, conflicting with this repository's workflow |

Keep fresh contexts for research/review, parent-selected tools, no recursion, parent-owned plans, and the existing default tool renderer. Do not import fleet widgets, schedules, automatic commits/worktrees, or transcript inheritance simply for feature parity.

High-value improvements are transport correctness, uniformly bounded results, artifact references, and a concurrency budget shared across sibling tool calls. An extra generic `context` field is unnecessary for now: the existing private task file already carries an explicit context/handoff contract.

If durable async/resume later becomes essential, **Nico is the stronger candidate to trial**. Evaluate a constrained fork against the local agent definitions and policies rather than reproducing its entire orchestration system in `runner.ts`. Validate the Nix Node entrypoint specifically; its standalone-binary support claims do not automatically cover this packaging.

Sources: Nico [tool reference](https://github.com/nicobailon/pi-subagents/blob/c8dd65564c7e7f0cef735f0e7a1577f2f72b674a/docs/tool-reference.md), [result publication](https://github.com/nicobailon/pi-subagents/blob/c8dd65564c7e7f0cef735f0e7a1577f2f72b674a/src/runs/background/result-files.ts), [CI](https://github.com/nicobailon/pi-subagents/blob/c8dd65564c7e7f0cef735f0e7a1577f2f72b674a/.github/workflows/test.yml); tintinweb [manager](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-manager.ts), [runner](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/agent-runner.ts), [worktree behavior](https://github.com/tintinweb/pi-subagents/blob/e955e29c51b7a6cce37e1108cd2d6c57a77e151c/src/worktree.ts).

## Implementation plan

### 1. Establish the two upstream-tracking forks and packaging

- Create `michaelmechenko/pi-lens` and `michaelmechenko/pi-btw` during approved execution. Neither existed when checked. Keep source checkouts outside dotfiles and outside Pi's package cache.
- Set `origin` to the fork and `upstream` to the original repository. Preserve upstream layout/license; maintain a small integration branch. Use explicit `git fetch upstream` and reviewed merges into that branch, not manual file recopying or force-syncing away patches.
- Record tested fork commits and build hashes in the dotfiles deployment. Upstream synchronization and production updates are separate: fetch/merge, test, publish with permission, update pins, build, activate.
- On macOS, install the pinned Git package sources from the forks. On NixOS, build those same pinned sources and add explicit `xdg.configFile` deployments at `pi-config/agent/packages/lens` and `pi-config/agent/packages/btw`. Each directory retains the fork's package manifest and built entrypoint. Pi's supported local-package loader then uses entries such as `{ "source": "./packages/lens", "skills": [], "prompts": [], "themes": [] }` in the Linux settings package list, and the equivalent for BTW; relative paths resolve against `agent/settings.json`. Apply these entries both to `linuxSettings` seeds and the existing live settings migration. Load each package exactly once; do not also create auto-discovered extension wrappers.
- Add a dedicated Lens derivation for its built entrypoint, native ast-grep dependencies, and fixed-output grammar assets. Reuse simple packaging for BTW where possible. Keep build-time downloads separate from runtime behavior.
- Use native package filtering to exclude unrequested skills/prompts/themes. Do not rename upstream packages or restructure source merely to satisfy local extension-directory naming conventions; these are external fork packages, not copied local extensions.

Acceptance: both package entrypoints load against the actual Pi 0.86.1 installation in an isolated agent directory; runtime credentials are not copied; Lens dependency/grammar loading works with network acquisition disabled. Compatibility failures block deployment, not trigger an unrequested Pi upgrade.

### 2. Migrate Lens and remove both protection extensions

- Translate LSP configuration to Lens's schema, including disabled languages, command/argument separation, project overrides, and root behavior. Inventory relevant `.pi/lsp.json` overrides before retiring old semantics; do not rewrite arbitrary projects automatically.
- Add the explicit Lens config path and Nix install-disable variables. Provision required binaries through the existing Nix package layer. Set the initial Lens profile described above.
- Remove pi-lsp from tracked settings, Linux defaults, `nix/packages/pi-runtime/package.json`/lockfile, and the pi-lsp-specific substitution in `pi-runtime.nix`; refresh dependency hashes.
- Remove `agent/extensions/lsp-startup/`, its filter, and the old `agent/extensions/lsp/config.json` after migration.
- Remove `agent/extensions/protected-paths/` and `agent/extensions/permission-gate/`, including their own tests and stale settings filters. Remove only their policy-specific checks/documentation; preserve independent plan-mode and project-trust tests.
- Update agent tool declarations and guidance from `lsp` to Lens's actual navigation/diagnostics tools. Ensure the parent can delegate those tools before spawning a narrowed child.
- Extend retained plan-mode handling for the selected Lens tools: block mutation-only tools and make `checkRestrictedToolCall` accept tool arguments, with `index.ts` passing `event.input`. Pin a parameter-aware policy to the reviewed Lens schema: permit audited read-only `lsp_navigation` operations, reject `rename`, `rename_file`, `executeCommand`, and applying code actions while restricted; allow inspection-only code-action requests only after verifying their exact flags. Reject `lens_diagnostic_mark` source suppression and `ast_grep_replace` mutations. Test direct invocation as well as lazy activation; activation must not remove execution-time checks or widen the parent's tool policy. Keep inspection available. This preserves requested modes, not a new protected-path policy. Remember that bash remains intentionally available: these restrictions are not an OS sandbox.
- Verify Lens hooks compose with `diff`'s edit/write/apply_patch shapes and mutation queue. Do not allow background format/fix to alter files while a restricted parent only inspects them.

Acceptance: TS/Python/Bash navigation and deliberate diagnostic errors work; disabled languages stay disabled; only one LSP client integration is loaded; read/commit guards remain off; a missing dependency yields a clear unavailable result without an installer; restricted modes remain inspection-only for direct Lens mutations.

### 3. Integrate BTW with a minimal compatibility patch

- Keep upstream commands/modes, hidden-thread persistence, model/thinking controls, and explicit handoff.
- Intersect child built-in tool selection with the current parent active set. Reconcile restrictions before each side prompt. For a parent access-mode change while BTW is streaming, add one narrow mode-transition integration: abort and await the active BTW request before committing the new parent mode, then recreate/restrict the child before its next prompt. This prevents stale writable side tools from continuing after the UI enters plan/read-only mode. Do not rely on a start-time snapshot or load the full plan extension into the child. Test in-flight transitions and cancellation failure explicitly.
- Do not reintroduce the removed protection extensions. Do not inherit all global extensions, duplicate session-state PID publication, or attach parent-owned plan tools.
- Retain upstream coding modes outside restricted modes. Document `/btw:ask` for simultaneous same-checkout discussion, and parent handoff for implementation. This is a workflow convention, not a claimed sandbox or cross-process lock.
- Remap the conflicting BTW resize shortcut without changing tmux's `M-w`. Keep at least one focus chord reachable through Ghostty/tmux and outside tmux. Update `KEYBINDS.md` after validation.
- Verify context seeding after compaction, branch navigation, reload/new/resume/fork, cancellation, explicit injection, and model overrides. Verify side-thread entries stay out of parent context unless explicitly injected/saved.
- Confirm image behavior when a text-only model is selected: BTW does not inherit image-proxy. Document unsupported input or add a focused adapter only if necessary; do not silently claim parity with the main session.

Acceptance: BTW opens while the parent runs; Escape aborts only its request before dismissing; focus returns correctly; no stale child appends to a replacement session; parent model/tools do not change; TUI works narrow/wide, framed/full-width, focused/unfocused, idle/streaming/error, directly and inside tmux.

### 4. Improve the existing background/delegation implementations

**Tmux: durable output and timely delivery**

- Add private job log artifacts captured from launch, with a bounded disk-retention policy. Do not depend on `capture-pane` after a short-lived pane exits. Preserve terminal/PTY behavior; verify a logging approach rather than blindly replacing execution with a pipe to `tee`.
- Add originating Pi session/branch identity and tmux socket identity to new records. Retain readable version-1 records, but do not guess an owner or inject their output into whichever session starts next.
- Observe durable completion-file publication with an event-driven watcher while Pi is active. Register the directory watcher before the initial reconciliation; coalesce events into a scan of durable done records rather than trusting an event filename. Reconcile again after watcher errors/rebinding and at startup/tool boundaries as recovery; explicitly report watcher failure rather than silently promising prompt delivery. No pane polling. Dispose/rebind observers on session replacement/reload.
- Keep completion state separate from notification acknowledgement. Use stable event IDs and deduplication; do not claim crash-proof exactly-once delivery without a transaction. Route model-visible completion summaries to the owner as queued follow-up/next-turn context, not an unrelated session.
- Expose bounded log reads through the existing tool/command surface, including after pane exit. Keep the 50 KiB/2,000-line model-visible limit and a full retained-log path.
- The current silence timer measures elapsed time since launch, not last output. Derive inactivity from log activity or rename its semantics; do not repeatedly warn a busy job as silent.
- Preserve run/attach/peek/list/mute and the no automatic pane/window/session termination guarantee. No new cancellation feature is required.

**Subagent: correct transport and bounded artifacts**

- Reproduce valid large aggregate terminal events in tests and an actual Pi 0.86.1 JSON stream before selecting the transport fix. Add bounded rejection metadata (record number, byte count, rejection class; no raw private payload) so future failures are diagnosable. Choose a bounded producer-side event projection or bounded streaming decoding that can validate terminal metadata without retaining duplicated full histories. Do not merely remove the cap, infinitely raise it, or accept every dropped event as success. The synthetic cap failure is proven; the two observed research failures remain unclassified.
- Distinguish malformed JSON from oversized valid events in diagnostics. Keep terminal-state validation, retry/cancellation correctness, timeout, and owned-process-group cleanup.
- Apply one explicit result policy to single, parallel, chain, error output, chain handoff, and details. Bound total parallel output as well as each child; eight 50 KiB results are not a 50 KiB tool result.
- Store full accepted final output in private artifacts when the parent-visible summary is truncated; return the real path. Bound retained message/details bytes, not only their count. Keep task prompts private and remove them after completion; retained result artifacts need documented cleanup/retention.
- Use one extension-session concurrency limiter across all subagent invocations. The current limit of four applies only inside one parallel call; sibling single/parallel tool calls can exceed it. Preserve ordered results, cancellation of queued work, and usage accounting.
- Keep the existing tool renderer, explicit task-file handoffs, fresh contexts, role definitions, and project-agent approval. No background agent mode, resumes, schedules, nested delegation, or worktree manager in this iteration.

Acceptance: valid large research runs settle correctly; truly malformed streams still fail; outputs/details remain bounded; artifacts are readable and private; multiple simultaneous tool calls obey the shared concurrency limit; tmux completion arrives once during ordinary operation without repeated peeks, and output survives pane exit/reload/restart.

### 5. Verify, document, migrate the live installation, and retain rollback

Affected integration files:

- `pi-config/agent/settings.json`, agent definitions/prompts that mention `lsp`, and the affected local extension tests/READMEs.
- `pi-config/agent/extensions/{plan-mode,subagent,tmux,tool-toggle}/` where integration changes are needed; do not refactor unrelated renderers.
- `nix/home/pi.nix`, `nix/packages/pi-extensions.nix`, `nix/packages/pi-runtime.nix`, its package manifest/lockfile, and dedicated fork derivations/pins.
- `pi-config/check.mjs`, `pi-config/README.md`, `nix/README.md`, relevant Pi sections of root `AGENTS.md`, and `KEYBINDS.md`. Edit `AGENTS.md`, never its `CLAUDE.md` symlink.

Verification and rollout:

- Run focused local tests plus upstream compatibility tests for the selected pins. Test package discovery and startup/reload in an isolated agent directory; `pi --help` alone is insufficient because it need not start a session or exercise lifecycle hooks.
- Build Nix outputs without activation. Verify the runtime can locate native dependencies/grammars and stays offline for installation paths.
- Use an isolated tmux socket and attached client for completion/PTY/logging cases and actual BTW shortcut/rendering tests. Do not disturb live panes.
- Update the network-free audit to recognize external fork packages and migrated Lens config, and remove obsolete required-protection/pi-lsp assertions. Document the tracked default model accurately without replacing the live one.
- Back up the live **public configuration files being changed**, not credentials or session history. Patch only package sources and obsolete extension filters. Because deployment is seed-only, explicitly migrate existing writable npm state instead of assuming a rebuild changes it. Build a replacement settings file from the current live JSON, validate the local package paths, and publish through a sibling temporary file plus rename; detect concurrent settings edits and stop rather than overwrite them. For npm cleanup, stage the existing package manifest/lockfile in a private sibling directory, remove only pi-lsp, and build/validate the replacement dependency tree while preserving unrelated user-installed packages. Activate the staged package directory during an agreed no-Pi-startup/reload window using a backup-and-rename sequence with recovery on failure. This is a coordinated migration, not an atomic transaction across settings, dependencies, and Home Manager; retain backups until all three are verified.
- After explicit activation approval, activate Home Manager, apply the scoped live settings/package migration, and start a fresh Pi session. Confirm removed extensions are absent and each new package loads exactly once.
- Rollback: restore the previous Home Manager generation and the backed-up settings/package manifests, re-enable the previous package sources, and start a fresh Pi session. Keep the old runtime closure available until acceptance checks finish. Do not destroy existing session history or tmux jobs.

## Deferred and authorization boundaries

This document proposes work; it does not authorize immediate implementation. GitHub forks were selected as the maintenance model, but none was created during planning. Commits/pushes, upstream PRs, and live activation remain explicit execution actions under repository policy.

Deferred: replacing pi-ast-grep, enabling broad Lens automation, implementing durable background agents, importing fleet UIs/workflows, and changing unrelated model/provider settings.

All upstream compatibility assessments are source/manifest/CI reviews, not installation tests against this exact Nix closure. Existing local test results and the synthetic decoder reproduction above are the empirical checks performed.
