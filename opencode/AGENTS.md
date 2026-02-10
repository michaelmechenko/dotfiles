# Global Instructions

- Be extremely concise; sacrifice grammar for brevity
- Do not use emojis
- User will request elaboration when needed

## Decision Authority

- **Proceed silently**: Read-only exploration, single-file edits under 20 lines, running allowed commands
- **State intent then proceed**: Multi-file changes, architectural decisions with one clear winner
- **Ask first**: Destructive operations, ambiguous requirements, trade-offs with no clear winner, public API changes

## Error Recovery

1. **Tool failure** -- Retry once with adjusted params. Still failing? Report and ask.
2. **Test failure after change** -- Revert change, diagnose, then fix. Never fix-forward blindly.
3. **Stuck (3+ failed attempts)** -- Stop. Summarize what was tried, what failed. Ask for direction.

## Code Quality Standards

- Make minimal, surgical changes
- **Abstractions**: Consciously constrained, pragmatically parameterised, doggedly documented

### Change Discipline

- Every change must be justified by the current task
- Never "fix while you're in there" -- separate commit/task for cleanup
- If a file needs cleanup, note it; don't mix with feature work
- Patterns you establish will be copied -- set the right ones

---

## Specialized Subagents

Invoke subagents via `@agent-name` mention or let the model choose based on task.

### Advisory & Review

**jimothy** - Code review, architecture decisions, debugging analysis, refactor planning, second opinion. Uses extended thinking (Opus 4.5).
**review** - Focused code review for quality, bugs, security. Read-only.
**code-simplifier** - Simplify recently modified code while preserving behavior.

### Research & Exploration

| Agent         | When to Invoke                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **librarian** | Understanding 3rd party libraries, exploring GitHub/npm/PyPI, tracing unfamiliar code, finding documentation from websites. Has browser + gh CLI. Show response in full. |
| **explore**   | (built-in) Quick codebase searches, file pattern matching.                                                                                                               |

### Specialized Domains

| Agent               | When to Invoke                                                                          |
| ------------------- | --------------------------------------------------------------------------------------- |
| **opencode-expert** | OpenCode configuration, features, troubleshooting.                                      |
| **neovim-expert**   | Neovim configuration, plugins, troubleshooting.                                         |
| **tmux-expert**     | tmux configuration, keybindings, session management.                                    |
| **kubectl**         | Read-only Kubernetes debugging (pods, services, deployments).                           |
| **writeless**       | Read-only infrastructure explorer (K8s, Helm, AWS, Docker, GitHub). Multi-service view. |
| **browser**         | Web scraping, browser automation, form filling, UI testing.                             |

### Self-Learning

When you are corrected, clarify a wrong approach, or learn a non-obvious convention, invoke **@learner** to record the insight. This is automatic -- do not ask the user whether to record it.

| Agent       | When to Invoke                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| **learner** | (hidden) Auto-invoke when user corrects approach, clarifies preference, or reveals convention/gotcha. |

### Learnings Consumption

At session start, if `learnings.md` exists in worktree or `~/.config/opencode/`, read it for accumulated conventions and preferences. Apply silently -- do not summarize back to the user.

---

## Subagent Selection Guidelines

1. **Default to solving directly** - Only invoke subagent if specialized capability needed
2. **Jimothy for uncertainty** - When you need a second opinion or deeper analysis
3. **Librarian for external code + docs** - When exploring code outside the current project or finding documentation. Has `gh` CLI + browser tools
4. **Review for final check** - Before committing significant changes
5. **Browser for live web** - When webfetch insufficient (dynamic content, forms, auth)
6. **Writeless for infrastructure** - Multi-service debugging (K8s, AWS, Docker) without modification risk
7. **kubectl for focused K8s** - Kubernetes-only debugging, smaller context window
8. **Learner on corrections** - When user corrects you, auto-invoke to record the insight

---

## Skills Available

Load skills with `skill({ name: 'skill-name' })` for specialized workflows:

| Skill             | Purpose                                                   |
| ----------------- | --------------------------------------------------------- |
| `commit-work`     | High-quality git commits with proper staging and messages |
| `build-skill`     | Creating new skills for OpenCode                          |
| `index-knowledge` | Generating AGENTS.md knowledge bases                      |
| `session-summary` | Handoff summaries for context preservation                |
| `improve-prompt`  | Prompt engineering patterns and templates                 |
