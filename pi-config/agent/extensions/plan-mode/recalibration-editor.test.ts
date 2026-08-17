import assert from "node:assert/strict";
import test from "node:test";
import { appendRecalibrationClipboardPaste, buildRecalibrationMessage, readRecalibrationClipboardPaste, type ClipboardReaders } from "./recalibration-draft.ts";

const imageReaders: ClipboardReaders = {
	readImage: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }),
	readText: async () => "ignored text",
};

test("clipboard image paste adds a visible marker and ImageContent", async () => {
	const paste = await readRecalibrationClipboardPaste(imageReaders);
	assert.deepEqual(paste, { kind: "image", image: { type: "image", data: "AQID", mimeType: "image/png" } });
	const draft = appendRecalibrationClipboardPaste({ text: "Move this", images: [] }, paste);
	assert.deepEqual(draft, {
		text: "Move this[Pasted image]",
		images: [{ type: "image", data: "AQID", mimeType: "image/png" }],
	});
	assert.deepEqual(buildRecalibrationMessage("Canonical execution context", draft), [
		{ type: "text", text: "Canonical execution context\n\nUser requested changes:\nMove this[Pasted image]" },
		{ type: "image", data: "AQID", mimeType: "image/png" },
	]);
});

test("clipboard text is the fallback when no image is available", async () => {
	const readers: ClipboardReaders = { readImage: async () => null, readText: async () => "paste text" };
	const paste = await readRecalibrationClipboardPaste(readers);
	assert.deepEqual(paste, { kind: "text", text: "paste text" });
	assert.deepEqual(appendRecalibrationClipboardPaste({ text: "before ", images: [] }, paste), { text: "before paste text", images: [] });
});

test("text fallback survives an unavailable image clipboard", async () => {
	const paste = await readRecalibrationClipboardPaste({ readImage: async () => { throw new Error("image clipboard unavailable"); }, readText: async () => "fallback text" });
	assert.deepEqual(paste, { kind: "text", text: "fallback text" });
});

test("empty clipboard produces no draft change", async () => {
	const paste = await readRecalibrationClipboardPaste({ readImage: async () => null, readText: async () => null });
	assert.equal(paste, undefined);
	assert.deepEqual(appendRecalibrationClipboardPaste({ text: "keep", images: [] }, paste), { text: "keep", images: [] });
});
