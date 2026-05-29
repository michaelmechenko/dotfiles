---
name: smap-update
description: "Record or update the session map for the current project: this session's goals, what was accomplished, what's still open, and the project's major todos. Use when asked to update the smap, session map, save session progress, log what was done, or record open todos for the project."
allowed-tools: Bash, Read, Edit, Write
---

# Session Map — Update

Persist the current session into the project's durable session map, and refresh the project's
brief in-repo todo list. Overwrites the current session's block (idempotent) rather than
appending duplicates.

## Two artifacts

- **Durable log** — `~/.config/smap/<project-slug>.md`. One block per session, newest first.
- **In-repo working list** — `SMAP-TODOS.md` at the repo root. Brief major todos across the
  project, gitignored locally so it survives branch switches without being committed.

## Identity & paths

```bash
root=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
tmp="${root//\//-}"; slug="${tmp//./-}"   # / and . → - (matches Claude's projects/ scheme; pure bash, no subprocess/prompt)
log=~/.config/smap/"$slug".md
```

Session id: use `$CLAUDE_SESSION_ID` if set. Otherwise find the most recent
`~/.config/claude/sessions/*.json` whose `cwd` equals `$root` and read its `sessionId`.
Date: `date +%F`.

## Block format (markdown, newest block on top)

```
## <YYYY-MM-DD> — <sessionId> — <short-title>
- Goal: ...
- Done: ...
- Open: ...
- Files: comma,separated,paths
- Notes: (optional)
```

## Workflow

1. Gather this session's content: goal(s), what was accomplished, what's still open, key files
   touched. Keep each field to a few lines.
2. `mkdir -p ~/.config/smap`.
3. Update the durable log (**overwrite semantics**):
   - If `$log` exists and its **latest block's `<sessionId>` matches the current session**,
     rewrite that block in place (use Read + Edit on the block).
   - Otherwise prepend a fresh block to the top of the file (create the file if absent).
4. Refresh `SMAP-TODOS.md` at `$root`:
   - Write/update a brief, scannable list of the project's *major* open todos (not a full log —
     just the handful that matter). Pull from this session's Open items plus any still-open
     items already listed.
   - **Tag each task with the session(s) it's associated with**, using short 8-char session-id
     prefixes (the full ids live in the durable log). Format:
     `- [ ] <task> — sessions: <id8>[, <id8>...]`
   - Attribution rules when refreshing:
     - New task surfaced this session → tag with the current session's id8.
     - Carried-over task that this session advanced/touched → append the current id8 if absent
       (a task may list several sessions).
     - Untouched carried-over task → leave its existing tags unchanged.
   - Keep it short; prune done items (drop them or move to a `## Done` section without tags).
5. Ensure `SMAP-TODOS.md` is gitignored locally (only when inside a git repo):
   ```bash
   ex="$root/.git/info/exclude"
   grep -qxF 'SMAP-TODOS.md' "$ex" 2>/dev/null || echo 'SMAP-TODOS.md' >> "$ex"
   ```
   Use `.git/info/exclude` (not the tracked `.gitignore`) so the ignore is local and never
   committed. Skip this step if `$root` is not a git repo.
6. Confirm to the user what was written (paths + the session id), briefly.

## Guidelines

- Overwrite the current session's block; never leave duplicate blocks for one session id.
- `SMAP-TODOS.md` stays brief and current — it is a working list, not an archive. The durable
  per-session history lives in `~/.config/smap/<slug>.md`.
- Do not commit anything. This skill only writes the map files and the local exclude entry.
