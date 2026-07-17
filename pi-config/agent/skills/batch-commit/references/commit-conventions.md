# Commit & PR Conventions (canonical)

Single source of truth for **commit messages and PR title/body** across sessions. The `batch-commit`
skill (incl. `--pr`) and the `cx-handoff` skill follow this. A repo's own committed rule (CONTRIBUTING, a
commit-msg hook, an existing consistent history) overrides this — match the repo when it differs.

## Format — Conventional Commits

```text
<type>(<scope>): <summary>

<What changed.>
<Why it changed.>
```

- **type** ∈ `feat | fix | docs | refactor | perf | test | build | ci | chore`
- **scope** = the affected module/area (e.g. `smap`, `statusline`, `mcp`). Optional but preferred.
- **summary** = imperative mood ("add", "fix", "remove"), ≤72 chars, no trailing period.
- **body** = what changed + why. Wrap ~72 cols. Omit for trivial one-liners.
- **breaking**: `!` after type/scope (`feat(api)!:`) and/or a `BREAKING CHANGE:` footer.

## Rules

- **No emojis** anywhere — subject, body, PR title, PR body.
- **No fluff** — drop "This commit…", "Basically", "Just", filler adjectives, and restating the
  diff line-by-line. Preserve the key what/why and any non-obvious rationale, gotcha, or caveat.
- **Imperative, present tense** — "add X", not "added X" / "adds X".
- Lowercase summary after the `type(scope):` prefix (proper nouns keep their case).
- One logical change per commit; if the summary needs "and", split the commit.

## PR title & body

- **Title** = one Conventional Commit line summarizing the whole PR (same format/rules as above).
- **Body**:
  ```markdown
  ## Summary
  - <bullet: what this PR does / why>
  - <bullet>

  ## Test plan
  - <bullet: how it was verified — command, manual step, or "n/a — docs only">
  ```
- Same no-emoji / no-fluff / imperative discipline. Keep bullets tight.
