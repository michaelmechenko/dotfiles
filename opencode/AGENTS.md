# Global Instructions

- Be concise; sacrifice grammar for brevity
- Do not use emojis
- User will request elaboration when needed
- Never use markdown tables -- use bullet lists instead (tables render poorly in terminals)

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

- **jimothy** -- Code review, architecture decisions, debugging analysis, refactor planning, second opinion.
- **review** -- Focused code review for quality, bugs, security. Read-only.
- **code-simplifier** -- Simplify recently modified code while preserving behavior.

### Research & Exploration

- **librarian** -- Understanding 3rd party libraries, exploring GitHub/npm/PyPI, tracing unfamiliar code, finding documentation from websites. Has browser + gh CLI. Show response in full.
- **explore** -- (built-in) Quick codebase searches, file pattern matching.

### Specialized Domains

- **opencode-expert** -- OpenCode configuration, features, troubleshooting.
- **neovim-expert** -- Neovim configuration, plugins, troubleshooting.
- **tmux-expert** -- tmux configuration, keybindings, session management.
- **kubectl** -- Read-only Kubernetes debugging (pods, services, deployments).
- **writeless** -- Read-only context explorer (K8s, Helm, AWS, Docker, GitHub, local dev). Multi-service view.
- **browser** -- Web scraping, browser automation, form filling, UI testing.
- **bashless** -- Execute shell commands without spawning a persistent shell. Best for single commands.

---

## Subagent Selection Guidelines

1. **@default to solving directly** -- Only invoke subagent if specialized capability needed
2. **@jimothy for uncertainty** -- When you need a second opinion or deeper analysis
3. **@librarian for external code + docs** -- When exploring code outside the current project or finding documentation. Has `gh` CLI + browser tools
4. **@review for final check** -- Before committing significant changes
5. **@browser for live web** -- When webfetch insufficient (dynamic content, forms, auth)
6. **@writeless for infrastructure and local context** -- Multi-service debugging (K8s, AWS, Docker) and local file/code exploration without modification risk
7. **@kubectl for focused K8s** -- Kubernetes-only debugging, smaller context window

---

## Skills Available

Load skills with `skill({ name: 'skill-name' })` for specialized workflows:

- `commit-work` -- High-quality git commits with proper staging and messages
- `build-skill` -- Creating new skills for OpenCode
- `index-knowledge` -- Generating AGENTS.md knowledge bases
- `session-summary` -- Handoff summaries for context preservation
- `improve-prompt` -- Prompt engineering patterns and templates
- `grep` -- Search any folder/file using ripgrep (rg) for context
