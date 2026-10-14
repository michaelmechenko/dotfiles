import assert from "node:assert/strict";
import test from "node:test";
import { decideExecutionContinuation, MAX_EXECUTION_RESCUES } from "./execution-continuation.ts";

const boundary = { checkpoint: "bash:one", canContinue: true, pendingMessages: false, alreadyContinuing: false, completed: true, eligible: true };

test("continuation rescues one new checkpoint and converts a duplicate into attention", () => {
	const first = decideExecutionContinuation({ used: 0 }, boundary);
	assert.deepEqual(first, { kind: "continue", continuation: { used: 1, lastCheckpoint: "bash:one" } });
	const duplicate = decideExecutionContinuation(first.continuation, boundary);
	assert.equal(duplicate.kind, "wait");
	if (duplicate.kind === "wait") assert.equal(duplicate.continuation.waitFor?.kind, "external");
});

test("continuation never exceeds the persisted rescue bound", () => {
	const exhausted = decideExecutionContinuation({ used: MAX_EXECUTION_RESCUES, lastCheckpoint: "old" }, boundary);
	assert.equal(exhausted.kind, "wait");
	if (exhausted.kind === "wait") assert.equal(exhausted.continuation.waitFor?.kind, "budget");
});

test("provider aborts, queued work, and explicit waits never receive a rescue", () => {
	assert.deepEqual(decideExecutionContinuation({ used: 0 }, { ...boundary, completed: false }), { kind: "none" });
	assert.deepEqual(decideExecutionContinuation({ used: 0 }, { ...boundary, pendingMessages: true }), { kind: "none" });
	assert.deepEqual(decideExecutionContinuation({ used: 0, waitFor: { kind: "input", reason: "Need answer" } }, boundary), { kind: "none" });
});
