---
name: session-review
description: "Review the current project/session and propose config improvements: missing CLAUDE.md context, candidate skills/permissions from recurring queries or tool calls, and todo/preference updates. Proposes only — does not apply changes. Use when asked to review the session, reflect on the project setup, or find config gaps."
allowed-tools: Bash, Read, Grep, Glob
---

# Session Review

Reflect on the current project and recent sessions, then surface **recommendations and
proposals** to improve the Claude Code setup. Read-only and propose-only by default.

## What to review

Produce three sets of proposals:

1. **Missing CLAUDE.md context**
   - Read the project `CLAUDE.md` (and `.claude/CLAUDE.md` if present).
   - Compare against what actually came up this session: conventions, gotchas, source-of-truth
     files, reload/build steps that were learned but aren't documented.
   - Propose concrete additions (where + what), kept factual.

2. **Skill / permission candidates**
   - Scan recent activity for recurring patterns:
     - This session's tool calls and repeated user requests.
     - Optionally past transcripts: `~/.config/claude/projects/<project-slug>/<sessionId>.jsonl`
       (slug = project cwd with `/` and `.` → `-`), and session metadata in
       `~/.config/claude/sessions/*.json`.
   - Propose: new `permissions.allow` rules for commands/tools that repeatedly prompted; new or
     edited skills for multi-step procedures done by hand more than once.
   - Reference current rules in `~/.config/claude/settings.json` so proposals are additive and
     non-duplicative.

3. **Todo / preference updates**
   - Open items worth recording → suggest running `/smap-update`.
   - Preference signals (how the user wanted things done) → propose CLAUDE.md preference edits.

## Workflow

1. Determine project root and slug: `root=$(git rev-parse --show-toplevel)`, then
   `tmp="${root//\//-}"; slug="${tmp//./-}"` (both `/` and `.` → `-`; pure bash, no subprocess).
2. Read project `CLAUDE.md` and `~/.config/claude/settings.json` for current state.
3. If reviewing beyond the live session, sample recent transcripts/session metadata.
4. Emit the three proposal sets, each as a short bulleted list with concrete, ready-to-apply
   suggestions and where they'd go.
5. Offer next steps (e.g. "run `/update-config` to add these allows", "run `/smap-update`").
