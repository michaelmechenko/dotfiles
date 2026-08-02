# Plan Mode Extension

Read-only exploration mode for safe code analysis, plus tracked plan execution.

## Features

- **Built-in write tools disabled**: Disables edit/write while preserving other active tools
- **Bash allowlist**: Only read-only bash commands are allowed
- **Plan extraction**: Extracts numbered steps from `Plan:` sections
- **`plan_step` tool**: The agent calls this tool (not a text tag) to mark a step
  complete/uncomplete/skipped during execution - schema-enforced, so it's far more
  reliable than asking the model to emit a text marker
- **Progress widget**: Shows during execution; collapsible to a single compact line
  (`/plan-widget` or `Ctrl+Alt+T`) when the full checklist gets distracting
- **Interactive `/todos`**: Arrow keys + space/enter to manually cycle any step
  through pending → done → skipped → pending, independent of what the agent reports
- **`/plan-edit`**: Add/remove/reorder/reword plan steps mid-execution; unchanged
  step text keeps its completed/skipped state
- **Session persistence**: State survives session resume

## Commands

- `/plan` - Toggle plan mode
- `/plan-edit` - Edit the current plan's steps
- `/plan-widget` - Toggle the progress widget between full checklist and a
  compact single-line summary
- `/todos` - Open an interactive view of plan progress; toggle any step by hand
- `Ctrl+Alt+P` - Toggle plan mode (shortcut)
- `Ctrl+Alt+T` - Toggle the progress widget (shortcut)

## Usage

1. Enable plan mode with `/plan` or `--plan` flag
2. Ask the agent to analyze code and create a plan
3. The agent should output a numbered plan under a `Plan:` header:

```
Plan:
1. First step description
2. Second step description
3. Third step description
```

4. Choose "Execute the plan" when prompted
5. During execution, the agent calls the `plan_step` tool (`complete`/`skip`) as
   it finishes each step; the widget/status line update immediately
6. If a step needs manual correction (or the agent didn't call the tool), open
   `/todos` and toggle it yourself
7. Need to change the plan itself mid-run? `/plan-edit` opens it in your editor

## How It Works

### Plan Mode (Read-Only)
- Built-in edit/write tools disabled
- Other active tools remain available
- Bash commands filtered through allowlist
- Agent creates a plan without making changes

### Execution Mode
- Full tool access restored, plus the `plan_step` tool
- Agent executes steps in order, calling `plan_step` after each one
- Widget/status show live progress; `/todos` lets you correct it by hand
- If the model stops without marking all steps done (or not-done), you're
  prompted to say what actually happened, resume, adjust steps manually, or stop

### Command Allowlist

Safe commands (allowed):
- File inspection: `cat`, `head`, `tail`, `less`, `more`
- Search: `grep`, `find`, `rg`, `fd`
- Directory: `ls`, `pwd`, `tree`
- Git read: `git status`, `git log`, `git diff`, `git branch`
- Package info: `npm list`, `npm outdated`, `yarn info`
- System info: `uname`, `whoami`, `date`, `uptime`

Blocked commands:
- File modification: `rm`, `mv`, `cp`, `mkdir`, `touch`
- Git write: `git add`, `git commit`, `git push`
- Package install: `npm install`, `yarn add`, `pip install`
- System: `sudo`, `kill`, `reboot`
- Editors: `vim`, `nano`, `code`
