# Global Instructions

- Be concise; sacrifice grammar for brevity
- Do not use emojis
- Never use markdown tables -- use bullet lists instead (tables render poorly in terminals)

## Decision Authority

- **Proceed silently**: Read-only exploration, single-file edits under 20 lines, running allowed commands
- **State intent then proceed**: Multi-file changes, architectural decisions with one clear winner
- **Ask first**: Destructive operations, ambiguous requirements, trade-offs with no clear winner, public API changes

### Change Discipline

- Every change must be justified by the current task
- Never "fix while you're in there" -- separate commit/task for cleanup
- If a file needs cleanup, note it; don't mix with feature work
- Patterns you establish will be copied -- set the right ones

---

## Agent CLI Preferences

- Use `fd` for file discovery
- Use `rg` (ripgrep) for content search
- Use `git` and `gh` (GitHub CLI) liberally for version control and GitHub operations

## Available Agents

Native subagents (delegated to automatically or by request):

- **jimothy** -- Code review, architecture decisions, debugging analysis, refactor planning, second opinion
- **librarian** -- Understanding 3rd party libraries, exploring GitHub/npm/PyPI, tracing unfamiliar code, finding documentation from websites. Show response in full
- **kubectl** -- Read-only Kubernetes debugging (pods, services, deployments)
- **atlassian** -- Read-only Jira/Confluence explorer for issues, sprints, pages, JSM, automation, and API questions
- **n8n** -- n8n workflow designer: assess, create, test, and validate n8n workflows
- **tmux-agent** -- Tmux configuration, keybindings, session management
- **neovim-agent** -- Neovim configuration, plugins, troubleshooting

## Available Skills

Load skills for specialized workflows via `/skill-name` or let the model choose based on task.

### Advisory & Review

- **code-review** -- Focused code review for quality, bugs, security. Review uncommitted changes or PRs
- **plan-review** -- Review plans for overengineering, missing edge cases, and gaps
- **simplify** -- Simplify recently modified code while preserving behavior
- **config-audit** -- Audit Claude Code config for stale permissions, hook issues, skill gaps

### Research & Exploration

- **search** -- Search files using rg and fd
- **aws-lookup** -- AWS documentation lookup and architecture guidance via AWS docs MCP

### Workflow

- **commit-work** -- High-quality git commits with proper staging and messages
- **pr-create** -- Full PR lifecycle: branch, stage, commit, push, create PR via gh CLI
- **session-summary** -- Handoff summaries for context preservation
- **diff-summary** -- Show working tree changes or diff between branches
- **index-knowledge** -- Generating CLAUDE.md knowledge bases
- **copy-content** -- Copy content to clipboard via pbcopy
