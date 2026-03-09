---
name: config-audit
description: "Audit Claude Code configuration for stale permissions, unused tools, skill gaps, and hook issues. Use this skill when the user asks to review their Claude Code setup, check for config issues, audit permissions, clean up settings, optimize their Claude Code configuration, or says things like 'is my config clean', 'review my setup', 'what's broken in my config'. Also trigger when the user mentions permission errors, hook failures, or skill activation problems."
---

# Config Audit

Review Claude Code configuration for correctness, staleness, and optimization opportunities.

## Audit Checklist

Run through each section and report findings.

### 1. Settings Validation

Read `~/.claude/settings.json` and check:

- **JSON validity**: Parse and verify structure
- **Permission consistency**: No tool in both allow AND deny lists
- **Stale permissions**: Tools in allow/deny that don't match any available MCP tool names
- **Hook registration**: All hooks point to scripts that exist and are executable
- **Model setting**: Verify it's a valid model identifier
- **Plugin references**: All enabled plugins reference valid marketplace entries

### 2. CLAUDE.md Accuracy

Read `~/.claude/CLAUDE.md` and cross-reference:

- **Agent inventory**: Every agent listed in CLAUDE.md has a file in `~/.claude/agents/`, and every file in agents/ is listed
- **Skill inventory**: Every skill listed in CLAUDE.md has a directory in `~/.claude/skills/` with a SKILL.md, and every skill directory is listed
- **Selection guidelines**: Still accurate given current agents/skills

### 3. Skill Rules Validation

Read `~/.claude/skills/skill-rules.json` and check:

- **All skills covered**: Every skill in `~/.claude/skills/` has an entry in skill-rules.json
- **No phantom entries**: No rules for skills that don't exist
- **Keyword quality**: Flag overly broad keywords that cause false positives (single common words like "create", "review", "build")
- **Intent pattern validity**: Test each regex pattern compiles without error
- **Priority distribution**: Not everything should be "high" -- check for reasonable spread

### 4. Hook Health

For each hook script referenced in settings.json:

- **File exists** at the referenced path
- **Is executable** (has +x permission)
- **Runs without error** on sample input: `echo '{"prompt":"test"}' | bash <hook>`
- **Dependencies available**: Check for required tools (jq, grep, etc.)

### 5. Memory Files

Check `~/.claude/rules/memory-*.md`:
- Do the files exist?
- Are the Edit/Write/Read permissions in settings.json correct?
- Is content accumulating (not just headers)?
- Are entries dated and organized?

### 6. Project Coverage

For each project directory in `~/.claude/projects/`:
- Does the project root have a CLAUDE.md?
- Is the CLAUDE.md substantive (not just a stub)?
- Are there project-specific settings that might conflict with global settings?

## Report Format

```
## Config Audit -- <date>

### Issues Found
- [CRITICAL] <description> -- <fix>
- [WARNING] <description> -- <fix>
- [INFO] <description> -- <suggestion>

### Health Summary
- Settings: OK / N issues
- CLAUDE.md: OK / N issues
- Skill Rules: OK / N issues
- Hooks: OK / N issues
- Memory: OK / N issues
- Projects: OK / N issues

### Recommendations
- <prioritized list of improvements>
```

## Programmatic Checks

Where possible, verify things programmatically rather than just reading:

```bash
# Validate JSON
jq . ~/.claude/settings.json > /dev/null

# Check hook executability
for hook in $(jq -r '.. | .command? // empty' ~/.claude/settings.json); do
  expanded=$(eval echo "$hook")
  [[ -x "$expanded" ]] && echo "OK: $expanded" || echo "FAIL: $expanded not executable"
done

# Check agent files vs CLAUDE.md listing
ls ~/.claude/agents/*.md | xargs -I{} basename {} .md

# Check skill directories
ls -d ~/.claude/skills/*/SKILL.md | xargs -I{} dirname {} | xargs -I{} basename {}
```

## When to Run

- After adding new agents, skills, hooks, or MCP servers
- After changing permissions
- Periodically (monthly) to catch drift
- When something isn't working as expected (skills not triggering, permission errors)
