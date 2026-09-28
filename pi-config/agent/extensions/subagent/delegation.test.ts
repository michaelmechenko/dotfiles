import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CHAIN_STEPS, normalizeDelegationRequest, replacePreviousLiteral, resolveChildTools, SharedConcurrencyLimiter } from "./delegation.ts";

test("delegation accepts exactly one nonempty mode", () => {
	for (const params of [
		{},
		{ tasks: [] },
		{ chain: [] },
		{ tasks: [], agent: "scout", task: "inspect" },
		{ agent: " ", task: "inspect" },
	]) assert.throws(() => normalizeDelegationRequest(params, "/repo"));
	const request = normalizeDelegationRequest({ agent: " scout ", task: " inspect ", cwd: "src" }, "/repo");
	assert.deepEqual(request, { mode: "single", items: [{ agent: "scout", task: "inspect", cwd: "/repo/src" }] });
	assert.throws(() => normalizeDelegationRequest({ chain: new Array(MAX_CHAIN_STEPS + 1).fill({ agent: "scout", task: "inspect" }) }, "/repo"));
});

test("child tools can narrow the parent's effective policy but never widen it", () => {
	const parent = ["read", "bash", "write", "subagent", "plan_update", "plan_step", "plan_complete"];
	assert.deepEqual(resolveChildTools({}, parent), ["read", "bash", "write"]);
	assert.deepEqual(resolveChildTools({ tools: ["read", "write"] }, ["read", "bash"]), ["read"]);
	assert.deepEqual(resolveChildTools({ tools: [] }, parent), []);
});

test("shared limiter caps sibling calls and cancels queued work", async () => {
	const limiter = new SharedConcurrencyLimiter(2);
	let active = 0;
	let peak = 0;
	const tasks = new Array(6).fill(null).map(async () => {
		const release = await limiter.acquire();
		active++;
		peak = Math.max(peak, active);
		await new Promise((resolve) => setTimeout(resolve, 10));
		active--;
		release();
	});
	await Promise.all(tasks);
	assert.equal(peak, 2);
	assert.equal(limiter.activeCount, 0);

	const blocked = new SharedConcurrencyLimiter(1);
	const release = await blocked.acquire();
	const controller = new AbortController();
	const queued = blocked.acquire(controller.signal);
	controller.abort();
	await assert.rejects(queued, /aborted while waiting/);
	release();
	blocked.close();
	limiter.close();
});

test("chain context replacement is literal", () => {
	assert.equal(replacePreviousLiteral("Review {previous}", "$& $` $' $$"), "Review $& $` $' $$");
});
