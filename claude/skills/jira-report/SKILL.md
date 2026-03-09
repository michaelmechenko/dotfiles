---
name: jira-report
description: "Generate Jira reports: sprint summaries, velocity data, status updates, and standup prep. Use this skill whenever the user asks for a sprint report, sprint summary, standup update, velocity report, backlog overview, team status, work log, or wants to know what happened in a sprint. Also trigger when the user asks 'what did I work on', 'sprint progress', 'team velocity', or mentions preparing for a standup, retro, or sprint review."
---

# Jira Report

Generate structured reports from Jira data using MCP read-only tools.

## Report Types

### Sprint Summary

Query the current or specified sprint and produce an overview.

**Data gathering:**
```
JQL: project = <KEY> AND sprint in openSprints() ORDER BY status ASC, priority DESC
```
Or for a completed sprint:
```
JQL: project = <KEY> AND sprint = "<sprint name>" ORDER BY status ASC
```

**Output format:**
```
## Sprint: <name> (<start> - <end>)

### Completed (<count>)
- <KEY>-123: <summary> [<assignee>]
- ...

### In Progress (<count>)
- <KEY>-456: <summary> [<assignee>] -- <status>
- ...

### Not Started (<count>)
- <KEY>-789: <summary> [<assignee>]
- ...

### Blocked / Flagged
- <KEY>-101: <summary> -- <reason if available>

### Stats
- Completed: X of Y issues (Z story points)
- Carry-over: N issues from previous sprint
```

### Standup Prep

For a specific user's standup update:
```
JQL: assignee = "<user>" AND sprint in openSprints() AND status changed DURING (startOfDay(-1d), now()) ORDER BY updated DESC
```
Also query:
```
JQL: assignee = "<user>" AND sprint in openSprints() AND status != Done ORDER BY priority DESC
```

**Output format:**
```
## Standup -- <date>

### Yesterday
- Completed <KEY>-123: <summary>
- Progressed <KEY>-456: <summary> (<from status> -> <to status>)

### Today
- Continue <KEY>-456: <summary>
- Start <KEY>-789: <summary>

### Blockers
- <anything flagged or stalled>
```

### Velocity / Capacity

Query last N sprints:
```
JQL: project = <KEY> AND sprint in closedSprints() ORDER BY created DESC
```

Summarize per sprint:
- Issues completed vs committed
- Story points completed vs committed (if available)
- Carry-over count
- Average completion rate

### Backlog Overview

```
JQL: project = <KEY> AND sprint is EMPTY AND resolution = Unresolved ORDER BY priority DESC, created ASC
```

Group by:
- Priority (Critical, High, Medium, Low)
- Issue type (Bug, Story, Task, Epic)
- Age (created date buckets)

## Query Strategies

- Use `mcp__atlassian__searchJiraIssuesUsingJql` for structured queries
- Use `mcp__atlassian__search` (Rovo) for natural language searches
- Use `mcp__atlassian__getJiraIssue` to expand details on specific issues
- Use `mcp__atlassian__jiraRead` with `/rest/agile/1.0/board/{id}/sprint` for sprint metadata
- Use `mcp__atlassian__lookupJiraAccountId` to resolve usernames to account IDs for assignee queries

## Tips

- If the user doesn't specify a project, ask which one (or check recent session context)
- Sprint names vary by team -- if the JQL fails, try `sprint in openSprints()` without a specific name
- Story point fields are often custom fields. If `story_points` returns null, try `customfield_10016` or ask the user
- Dates in JQL use `"YYYY/MM/DD"` or relative functions like `startOfWeek()`, `endOfSprint()`
- Keep reports scannable -- use bullet lists, not paragraphs
