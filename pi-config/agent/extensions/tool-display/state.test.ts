import assert from "node:assert/strict";
import test from "node:test";
import {
	areToolOutputsWrapped,
	resetToolDisplayState,
	toggleToolOutputWrap,
} from "./state.ts";

test("tool output wrapping defaults on and resets per session", () => {
	resetToolDisplayState();
	assert.equal(areToolOutputsWrapped(), true);
	assert.equal(toggleToolOutputWrap(), false);
	assert.equal(areToolOutputsWrapped(), false);
	resetToolDisplayState();
	assert.equal(areToolOutputsWrapped(), true);
});
