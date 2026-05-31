---
name: smap-read
description: "Read the session map for the current project: goals, what was accomplished, and what's still open across all past sessions. Use when asked to read the smap, session map, what's left to do, open todos for this project, or to recall what prior sessions were working on."
allowed-tools: Bash, Read
---

# Session Map — Read

Surface the durable session map and the in-repo working todos for the current project, so
forgotten side-tasks and open items resurface.

## Two sources

- **Durable log** — `~/.config/smap/<project-slug>.md`. A pinned `## Findings & Directives`
  section at the top (durable project notes), then one block per session, newest first.
- **In-repo working list** — `SMAP-TODOS.md` at the repo root (git toplevel). Brief, current
  open todos across the project, plus a `## Notes` mirror of the findings/directives.

`<project-slug>` = the project directory with every `/` and `.` replaced by `-` (matches
Claude's own `projects/` scheme). Derive it from `$PWD` (or the git toplevel). Example:
`/Users/michael.mechenko/.config` → `-Users-michael-mechenko--config`.

## Workflow

1. Compute the slug and resolve the repo root:
   ```bash
   root=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
   tmp="${root//\//-}"; slug="${tmp//./-}"   # / and . → - (pure bash, no subprocess/prompt)
   ```
2. Print the durable log if present: `cat ~/.config/smap/"$slug".md`
3. Print the repo working list if present: `cat "$root"/SMAP-TODOS.md`
4. Summarize for the user, leading with the **`## Findings & Directives`** section if present —
   call out **directives** prominently (they are standing rules: "don't do X" / "remember Y"),
   then findings. After that, surface the **most recent session's Open items** plus the
   `SMAP-TODOS.md` list. Note the session id / date of the latest block.
   - Flag any directive marked `(candidate: CLAUDE.md)` — it's a standing rule not yet promoted to
     the auto-loaded `CLAUDE.md`; mention it so the user can decide.
   - Each `SMAP-TODOS.md` task carries `sessions: <id8>[, ...]` tags. Surface them so the user
     can see which session(s) a task came from. To expand an id8 to a full session or jump to
     its context, match the prefix against block headings in the durable log or against
     `~/.config/claude/sessions/*.json` / `projects/<slug>/<id8>*.jsonl`.

## Guidelines

- Read-only. Never modify the map here — that is `/smap-update`'s job.
- If neither file exists, say so plainly and suggest running `/smap-update` to start one.
- Keep the summary tight: open items first, then a one-line recap of recent goals/done.
