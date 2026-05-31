---
name: smap-backfill
description: "Recursively reconstruct the session map for an entire project — all past sessions including git worktrees — by parsing their transcripts, folding everything into one canonical per-project log. Idempotent; preserves existing blocks. Use to backfill history, consolidate fragmented worktree session maps, or populate smap for a project from scratch."
allowed-tools: Bash, Read, Edit, Write, Agent
---

# Session Map — Backfill (recursive, worktree-aware)

`/smap-update` captures only the live session. This skill enumerates **all** sessions belonging to
a project — main checkout **and** every git worktree — reconstructs an smap block per session from
its transcript, and folds them into **one canonical per-project log**, newest first.

Idempotent (keyed on `sessionId`) and preserve-existing by default (won't clobber rich
live-authored blocks).

## Invocation

`/smap-backfill [path] [--force] [--dry-run]`
- `path` — target project (default: current `$PWD`).
- `--dry-run` — list the sessions that would be added; write nothing.
- `--force` — rebuild every block from transcripts, replacing existing ones (default: skip
  sessions already present in the log).

## Why a separate skill from `smap-update`

Different workflow: batch transcript parsing, worktree canonicalization, single-writer merge.
`smap-update` stays the simple live-session tool. This skill reuses its block format and slug rule.

## Step 1 — canonical project identity (fold worktrees → main repo)

A git worktree's cwd (`<main-repo>/.claude/worktrees/<name>/...`) yields its own slug, which is why
session maps fragment. Canonicalize every cwd to the **main repo toplevel** so all worktree + main
sessions share one log.

<!-- NOTE: write positional refs in brace form (`${1}`, `${1:-…}`). Skill-arg substitution
rewrites bare `$1`/`$2` at load time, which would silently break helper-bash positionals. -->

```bash
# Parse skill args from $ARGUMENTS (flags may precede the path); don't rely on bare $1.
args="$ARGUMENTS"; dryrun=0; force=0; target=""
for a in $args; do
  case "$a" in
    --dry-run) dryrun=1 ;;
    --force)   force=1 ;;
    *)         target="$a" ;;
  esac
done
target="${target:-$PWD}"
root=$(git -C "$target" rev-parse --show-toplevel 2>/dev/null || echo "$target")
cdir=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
case "$cdir" in */.git) main=$(dirname "$cdir") ;; *) main="$root" ;; esac
# string fallback when the worktree checkout no longer exists:
case "$main" in *"/.claude/worktrees/"*) main="${main%%/.claude/worktrees/*}" ;; esac
tmp="${main//\//-}"; slug="${tmp//./-}"   # / and . → - (pure bash, no subprocess)
log=~/.config/smap/"$slug".md
```

Provide a reusable canonicalizer for arbitrary cwds during enumeration (git when the path exists,
else the `/.claude/worktrees/` string strip):

```bash
canon() {  # echo canonical main-repo toplevel for a given cwd
  local c="${1}" cd   # brace form: survives skill-arg substitution (bare $1 would be clobbered)
  cd=$(git -C "$c" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  case "$cd" in */.git) c=$(dirname "$cd") ;; esac
  case "$c" in *"/.claude/worktrees/"*) c="${c%%/.claude/worktrees/*}" ;; esac
  echo "$c"
}
```

## Step 2 — enumerate ALL sessions for the project

The full session set lives in transcripts, not `sessions/*.json` (which only tracks current
sessions). Enumerate robustly:

1. For every `~/.config/claude/projects/*/<sessionId>.jsonl`, read the embedded cwd and match:
   ```bash
   cwd=$(jq -r 'select(.cwd) | .cwd' "$f" | head -1)
   [ "$(canon "$cwd")" = "$main" ] && keep "$f"
   ```
   This sweeps the main `projects/` dir and every `…--claude-worktrees-*` dir in one pass.
2. Union with `~/.config/claude/sessions/*.json` whose canonicalized `cwd` == `$main` (gives
   `name` title + `startedAt` for sessions still tracked).
3. Fold existing per-worktree logs: any other `~/.config/smap/<other-slug>.md` whose recorded
   project path canonicalizes to `$main`. Read their blocks in for migration. **Do not delete**
   those files — at the end, print them as "superseded, safe to remove" and let the user decide
   (deleting files is always a user action).

## Step 3 — reconstruct one block per session (preserve-existing)

- Parse `$log` (if it exists) for `sessionId`s already present. **Skip** them — preserve rich
  live-authored blocks. With `--force`, rebuild all.
- For each remaining session, build a block in `smap-update`'s exact format, with a worktree tag:
  ```
  ## <YYYY-MM-DD> — <sessionId> — [main|worktree: <name>] <title>
  - Goal: ...
  - Done: ...
  - Open: ...
  - Files: comma,separated,paths
  - Notes: (backfilled from transcript; branch <gitBranch>)
  ```
  - `date`: from `startedAt` (epoch ms → `date -r $((startedAt/1000)) +%F`), else the earliest
    transcript `timestamp` (`...[:10]`).
  - tag: `[worktree: <name>]` if the cwd matched `/.claude/worktrees/<name>/`, else `[main]`.
  - `title`: `sessions/*.json` `name`; else a `customTitle` record; else the first user prompt.
  - Goal / Done / Open / Files: summarize the transcript — user goal(s), assistant
    accomplishments, the `Edit`/`Write` target paths touched, and anything left unresolved. Keep
    each field to a few lines. Always mark `Notes: (backfilled from transcript)` so reconstructed
    blocks are distinguishable from live-authored ones.

## Step 4 — single-writer merge + write

- Merge kept + new blocks, **dedup by `sessionId`**, **sort by date / `startedAt` descending**
  (newest first), under the `# Session Map — <main>` header.
- Build the full file content in context and emit it with **one `Write`** to `$log`. One writer,
  whole-file replace → no interleave window and no lockfile needed for this user-invoked batch.
  Re-running is safe (sessionId dedup).
- **Preserve the pinned `## Findings & Directives` section** if `$log` already has one — carry it
  through unchanged at the top, above the session blocks. Do **not** synthesize it: reconstructed
  directives/findings are unreliable, and that section is owned by live `/smap-update`. (Optional,
  minimal: you MAY add `- [directive] [id8] <text> (backfilled)` entries for user rules found
  *verbatim* in transcripts, but leave findings to live capture.)
- On `--dry-run`: print the list of sessions that *would* be added (id, date, tag, title) and the
  target `$log`; write nothing.
- **Do not touch `SMAP-TODOS.md`.** Stale "open" items from old sessions are unreliable; the live
  `/smap-update` owns that working list.

## Collision management

- **Worktree fragmentation** → canonicalize every cwd to the main toplevel; one log per project;
  blocks tagged with their worktree/branch. Existing per-worktree logs fold in (and are reported,
  not deleted).
- **Duplicate session** → `sessionId` is the primary key; preserve-existing by default, `--force`
  to rebuild. Globally-unique ids mean cross-worktree folding can't key-collide.
- **Concurrent write** → avoided by construction: one invocation builds the merged file and does a
  single whole-file `Write`. (If ever automated/parallelized, escalate to a `mkdir`-based lock +
  temp-file `mv` — not warranted now.)
- **Ordering** → sort by start time descending before writing.

## Scaling (optional)

Transcript summarization is the cost. For many/large transcripts, fan out per-session
reconstruction to subagents (`Agent`) — each returns a finished block string — then the orchestrator
still does the single serialized merge + `Write`. Default to inline for small session counts.

## Guidelines

- Read-heavy, single write. Never run N concurrent writers against one log.
- Never delete superseded per-worktree logs yourself; report them for the user to remove.
- Reconstructed blocks are best-effort; flag them as backfilled so future reviews trust live blocks
  more than reconstructed ones.
