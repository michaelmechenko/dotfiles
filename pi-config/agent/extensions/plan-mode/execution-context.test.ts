import assert from "node:assert/strict";
import test from "node:test";
import { renderExecutionContext } from "./execution-context.ts";
import { applyPlanUpdate, createPlanState } from "./plan-state.ts";

test("canonical execution context contains the brief, status, verification, cwd, and source identity", () => { const plan = applyPlanUpdate(createPlanState(), { goal: "Ship", steps: ["Implement", "Verify"], criteria: ["Tests pass"], followUps: ["Watch release"], executionBrief: { summary: "Safe handoff", findings: ["Current packet lacks acknowledgement"], decisions: ["Add acknowledgement"], relevantFiles: [{ path: "execution-handoff.ts", note: "packet lifecycle" }], constraints: ["Do not transfer transcript"] } }); plan.steps[0]!.completed = true; const text = renderExecutionContext(plan, { sessionId: "source-123", cwd: "/repo", tmuxSession: "work" }); for (const expected of ["Safe handoff", "Current packet", "Add acknowledgement", "execution-handoff.ts", "Do not transfer transcript", "[x] Implement", "Tests pass", "/repo", "source-123", "work"]) assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); });
