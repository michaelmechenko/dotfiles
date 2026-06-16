---
name: smap-update
description: "Record or update the session map for the current project: this session's goals, what was accomplished, what's still open, and the project's major todos. Use when asked to update the smap, session map, save session progress, log what was done, or record open todos for the project."
model: claude-sonnet-4-6[1m]
allowed-tools: Bash, Read, Edit, Write
---

# Session Map — Update

Persist the current session into the project's durable session map, and refresh the project's
brief in-repo todo list. Overwrites the current session's block (idempotent) rather than
appending duplicates.

## Two artifacts

- **Durable log** — `~/.config/smap/<project-slug>.md`. A pinned `## Findings & Directives`
  section at the top (durable project-level notes), then one block per session, newest first.
- **In-repo working list** — `SMAP-TODOS.md` at the repo root. Brief major todos across the
  project + a short `## Notes` mirror of the findings/directives, gitignored locally so it
  survives branch switches without being committed.

## Identity & paths

```bash
root=$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")
tmp="${root//\//-}"; slug="${tmp//./-}"   # / and . → - (matches Claude's projects/ scheme; pure bash, no subprocess/prompt)
log=~/.config/smap/"$slug".md
```

Session id: use `$CLAUDE_SESSION_ID` if set; otherwise the newest
`~/.config/claude/sessions/*.json` whose `cwd` equals `$root`. Use `jq` (not `node`):

```bash
sid="${CLAUDE_SESSION_ID:-}"
[ -z "$sid" ] && for f in $(ls -t ~/.config/claude/sessions/*.json 2>/dev/null); do
  sid=$(jq -r --arg r "$root" 'select(.cwd==$r)|.sessionId' "$f" 2>/dev/null)
  [ -n "$sid" ] && break
done
```

Date: `date +%F`.

## File layout

```
# Session Map — <root>

## Findings & Directives
<!-- durable, project-level; survives session blocks. [kind]=directive|finding, [id8]=origin session -->
- [directive] [bc376060] Never push from /batch-commit; commits only.  (candidate: CLAUDE.md)
- [finding] [bc376060] settings.json permission-widening is blocked by the self-mod classifier.

## <YYYY-MM-DD> — <sessionId> — <short-title>
- Goal: ...
- Done: ...
- Open: ...
- Files: comma,separated,paths
- Notes: (optional, session-ephemeral)
```

- The pinned `## Findings & Directives` section sits directly under the `# Session Map` H1, above
  all session blocks. It is durable project knowledge; it does **not** scroll away with sessions.
- The per-session `- Notes:` field is for *session-ephemeral* notes; the pinned section is for
  *durable project-level* knowledge. Keep them distinct.
- Notes list: one flat list. Each entry `- [kind] [id8] <text>` where `kind` ∈
  `directive` (a user rule: "don't do X" / "remember Y") | `finding` (a discovered project fact).

## Workflow

1. Gather this session's content: goal(s), what was accomplished, what's still open, key files
   touched. Keep each field to a few lines.
2. `mkdir -p ~/.config/smap`.
3. Update the durable log (**overwrite semantics**):
   - **Detect the latest session block by the date-prefixed pattern** `^## [0-9]{4}-[0-9]{2}-[0-9]{2} `
     — NOT the first `## ` (that may be the pinned `## Findings & Directives` section). If the
     latest *session block's* `<sessionId>` matches the current session, rewrite that block in
     place (Read + Edit).
   - Otherwise prepend a fresh block **after** the pinned `## Findings & Directives` section (or
     directly after the `# Session Map` H1 if no pinned section exists yet). Create the file if
     absent.
4. Update the pinned `## Findings & Directives` section (durable notes):
   - Gather this session's **directives** (user rules stated this session — "don't do X",
     "remember Y") and **findings** (important project facts discovered — source-of-truth files,
     gotchas, non-obvious behavior).
   - Merge into the pinned section (create it under the H1 if absent). **Dedup** against existing
     entries — don't duplicate; refine wording in place when it's the same fact. Tag each new
     entry `- [kind] [id8] <text>`.
   - For standing-rule directives, append `  (candidate: CLAUDE.md)`. At the end of the run,
     **offer** to promote those to the project `CLAUDE.md` — propose the exact edit but do **not**
     write `CLAUDE.md` without explicit confirmation. Once the user confirms a promotion, change
     that entry's marker to `(in CLAUDE.md)`. Findings are never promoted / never get the marker.
5. Refresh `SMAP-TODOS.md` at `$root`:
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
   - Mirror a brief `## Notes` section into `SMAP-TODOS.md` carrying the same flat
     `- [kind] [id8] <text>` list as the durable log's pinned section (keep it short — the
     durable log is the full record). Keep the two in sync.
6. Ensure `SMAP-TODOS.md` is gitignored locally (only when inside a git repo):
   ```bash
   ex="$root/.git/info/exclude"
   grep -qxF 'SMAP-TODOS.md' "$ex" 2>/dev/null || echo 'SMAP-TODOS.md' >> "$ex"
   ```
   Use `.git/info/exclude` (not the tracked `.gitignore`) so the ignore is local and never
   committed. Skip this step if `$root` is not a git repo.
7. Confirm to the user what was written (paths + the session id), briefly. If any directives are
   `(candidate: CLAUDE.md)`, offer promotion now.

## Guidelines

- Overwrite the current session's block; never leave duplicate blocks for one session id.
- The pinned `## Findings & Directives` section is durable — accumulate and dedup; never clobber
  prior entries when rewriting a session block (detect blocks by the date-prefixed pattern).
- `SMAP-TODOS.md` stays brief and current — it is a working list, not an archive. The durable
  per-session history lives in `~/.config/smap/<slug>.md`.
- Never auto-write `CLAUDE.md`. Promotion of a directive is always user-confirmed.
- Do not commit anything. This skill only writes the map files and the local exclude entry.
