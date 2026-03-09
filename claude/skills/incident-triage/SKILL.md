---
name: incident-triage
description: "Structured production incident triage combining Kubernetes debugging, log analysis, and Jira context. Use this skill whenever the user mentions an incident, outage, production issue, service down, pod crashing, alerts firing, on-call, pages, or needs to investigate a production problem. Also trigger when the user describes symptoms like '500 errors', 'high latency', 'OOMKilled', 'CrashLoopBackOff', or 'service unreachable'."
---

# Incident Triage

Structured workflow for investigating production incidents. Coordinates Kubernetes inspection, log analysis, and Jira context to quickly identify root cause.

## Triage Workflow

Follow this order. Each step informs the next -- don't skip ahead.

### Step 1: Scope the Incident

Clarify with the user:
- Which service/pod is affected?
- When did it start? (or when were they alerted?)
- What are the symptoms? (errors, latency, crashes, unreachable)
- What namespace/cluster/context?

If the user already provided this info, skip straight to investigation.

### Step 2: Quick Health Check

Run these via the kubectl agent or MCP tools in parallel:

- **Pod status**: `mcp__kubernetes__pods_list_in_namespace` -- look for non-Running pods, restarts, age
- **Pod details**: `mcp__kubernetes__pods_get` on affected pods -- check conditions, container statuses, last termination reason
- **Events**: `mcp__kubernetes__events_list` -- recent warnings, scheduling failures, image pull errors
- **Resource pressure**: `mcp__kubernetes__nodes_top` and `mcp__kubernetes__pods_top` -- CPU/memory usage

### Step 3: Log Analysis

- Pull recent logs: `mcp__kubernetes__pods_log` for affected pods
- If pod is crash-looping, check previous container logs (terminated container)
- Look for:
  - Stack traces and error messages
  - Connection refused / timeout patterns
  - OOM signals
  - Dependency failures (database, external APIs, message queues)
  - Timestamp of first error occurrence

### Step 4: Correlate with Recent Changes

- Check recent deployments: look at pod ages, image tags, replica set history
- Ask the user: "Were there any recent deployments, config changes, or infrastructure changes?"
- If Jira is relevant, search for recent deployment-related issues:
  - `mcp__atlassian__searchJiraIssuesUsingJql` with `labels = deployment AND updated >= -24h`

### Step 5: Check Dependencies

If the service depends on other services:
- Check those services' pod health too
- Look for cascading failures (service A down because service B is down)
- Check network policies, service endpoints, DNS resolution

### Step 6: Synthesize Findings

Present a structured report:

```
## Incident Summary
- **Service**: <name>
- **Status**: <current state>
- **Duration**: <since when>
- **Impact**: <what's affected>

## Root Cause (confirmed/suspected)
<what's actually wrong>

## Evidence
- <specific log lines, events, or metrics that point to the cause>

## Immediate Actions
- <what to do right now to restore service>

## Follow-up
- <longer-term fixes, monitoring improvements, post-mortem items>
```

### Step 7: Draft Jira Issue (if requested)

If the user wants to track this, draft a Jira issue description with:
- Incident timeline
- Root cause analysis
- Resolution steps taken
- Action items for follow-up

Since Jira write access is read-only, present the draft for the user to create manually.

## Common Failure Patterns

Quick reference for pattern matching during log analysis:

- **CrashLoopBackOff**: App crashes on startup. Check logs from terminated container, environment variables, config mounts
- **OOMKilled**: Memory limit exceeded. Check `resources.limits.memory`, look for memory leaks in logs
- **ImagePullBackOff**: Wrong image tag, registry auth, or network issue. Check image name and pull secrets
- **Pending**: No node can schedule the pod. Check resource requests vs available capacity, node selectors, tolerations
- **Connection refused**: Downstream service not listening. Check target service health, port configuration
- **High latency**: Check resource saturation, database query performance, network policies, HPA status

## Communication

- Lead with the most likely cause, not the full investigation log
- Distinguish confirmed facts from hypotheses
- If you can't determine root cause, clearly state what you ruled out and what remains to investigate
- Time-sensitive: be direct, skip pleasantries
