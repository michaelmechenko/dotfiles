# Global Instructions

- Be extremely concise; sacrifice grammar for brevity
- Do not use emojis
- User will request elaboration when needed

## Code Quality Standards

- Make minimal, surgical changes
- **Abstractions**: Consciously constrained, pragmatically parameterised, doggedly documented

### ENTROPY REMINDER

This codebase will outlive you. Every shortcut you take becomes
someone else's burden. Every hack compounds into technical debt
that slows the whole team down.

You are not just writing code. You are shaping the future of this
project. The patterns you establish will be copied. The corners
you cut will be cut again.

**Fight entropy. Leave the codebase better than you found it.**

---

## Specialized Subagents

Invoke subagents via `@agent-name` mention or let the model choose based on task.

### Advisory & Review

**jimothy** - Code review, architecture decisions, debugging analysis, refactor planning, second opinion. Uses extended thinking (Opus 4.5).
**review** - Focused code review for quality, bugs, security. Read-only.
**code-simplifier** - Simplify recently modified code while preserving behavior.

### Research & Exploration

| Agent          | When to Invoke                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| **librarian**  | Understanding 3rd party libraries, exploring GitHub/npm/PyPI, tracing unfamiliar code. Show response in full. |
| **doc-doctor** | Finding documentation from websites, verifying API/framework usage. Has browser tools.                        |
| **explore**    | (built-in) Quick codebase searches, file pattern matching.                                                    |

### Specialized Domains

| Agent               | When to Invoke                                                                          |
| ------------------- | --------------------------------------------------------------------------------------- |
| **opencode-expert** | OpenCode configuration, features, troubleshooting.                                      |
| **neovim-expert**   | Neovim configuration, plugins, troubleshooting.                                         |
| **tmux-expert**     | tmux configuration, keybindings, session management.                                    |
| **kubectl**         | Read-only Kubernetes debugging (pods, services, deployments).                           |
| **writeless**       | Read-only infrastructure explorer (K8s, Helm, AWS, Docker, GitHub). Multi-service view. |
| **browser**         | Web scraping, browser automation, form filling, UI testing.                             |

### Development Modes

| Agent         | When to Invoke                                                                           |
| ------------- | ---------------------------------------------------------------------------------------- |
| **general**   | (built-in) Multi-step tasks, parallel work units. Full tool access.                      |
| **bashless**  | Development without shell access. Use when shell is unavailable/restricted.              |
| **writeless** | Development with shell access. Use when context is necessary or commands need to be ran. |

---

## Subagent Selection Guidelines

1. **Default to solving directly** - Only invoke subagent if specialized capability needed
2. **Jimothy for uncertainty** - When you need a second opinion or deeper analysis
3. **Librarian for external code** - When exploring code outside the current project, has `gh` CLI access
4. **Review for final check** - Before committing significant changes
5. **Browser for live web** - When webfetch insufficient (dynamic content, forms, auth)
6. **Writeless for infrastructure** - Multi-service debugging (K8s, AWS, Docker) without modification risk
7. **kubectl for focused K8s** - Kubernetes-only debugging, smaller context window

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
