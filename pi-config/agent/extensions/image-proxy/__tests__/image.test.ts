/**
 * Unit tests for the pure helpers in `image.ts`.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --test \
 *     pi-config/agent/extensions/image-proxy/__tests__/image.test.ts
 *
 * These intentionally import only the pure helper module (no pi packages) so
 * the test runner needs no package resolution beyond this repo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildDescriptionFence,
  contentHasImages,
  FENCE_TAG,
  hashImageData,
  isImagePath,
  isImageBlock,
  MAX_IMAGE_BYTES,
  mimeTypeForPath,
  neutralizeFenceBody,
  replaceImageBlocks,
} from "../image.ts";

// ── mimeTypeForPath / isImagePath ────────────────────────────────────────────

test("mimeTypeForPath maps accepted extensions (case-insensitive)", () => {
  assert.equal(mimeTypeForPath("a.png"), "image/png");
  assert.equal(mimeTypeForPath("a.JPG"), "image/jpeg");
  assert.equal(mimeTypeForPath("a.jpeg"), "image/jpeg");
  assert.equal(mimeTypeForPath("a.gif"), "image/gif");
  assert.equal(mimeTypeForPath("a.webp"), "image/webp");
  assert.equal(mimeTypeForPath("a.bmp"), "image/bmp");
});

test("mimeTypeForPath returns null for non-image and missing extensions", () => {
  assert.equal(mimeTypeForPath("readme.txt"), null);
  assert.equal(mimeTypeForPath("script.ts"), null);
  assert.equal(mimeTypeForPath("Makefile"), null);
  assert.equal(mimeTypeForPath(""), null);
});

test("isImagePath is the boolean view of mimeTypeForPath", () => {
  assert.equal(isImagePath("photo.png"), true);
  assert.equal(isImagePath("photo.cr2"), false);
  assert.equal(isImagePath("/abs/path/to/IMG_0001.JPEG"), true);
});

// ── hashImageData ───────────────────────────────────────────────────────────

test("hashImageData is deterministic", () => {
  assert.equal(hashImageData("abc"), hashImageData("abc"));
  assert.equal(hashImageData("iVBORw0KGgo="), hashImageData("iVBORw0KGgo="));
});

test("hashImageData differs for different inputs", () => {
  assert.notEqual(hashImageData("abc"), hashImageData("abd"));
  assert.notEqual(hashImageData("a"), hashImageData("aa"));
});

test("hashImageData returns a short hex string", () => {
  const h = hashImageData("some-base64-data");
  assert.match(h, /^[0-9a-f]+$/);
  assert.ok(h.length <= 16);
});

// ── neutralizeFenceBody ─────────────────────────────────────────────────────

test("neutralizeFenceBody inserts a zero-width space into </ sequences", () => {
  const out = neutralizeFenceBody("text with </image_proxy_description> inside");
  assert.ok(!out.includes("</image_proxy_description>"));
  // The literal close tag can no longer re-form.
  assert.ok(out.includes("<\u200B/image_proxy_description>"));
});

test("neutralizeFenceBody leaves text without </ untouched", () => {
  assert.equal(neutralizeFenceBody("plain text <b>bold</b>"), "plain text <b>bold<\u200B/b>");
  // Note: it does transform every </ — that is the point.
});

// ── buildDescriptionFence ───────────────────────────────────────────────────

test("buildDescriptionFence wraps a description with indexed attributes", () => {
  const fence = buildDescriptionFence({
    index: 2,
    filename: "shot.png",
    description: "A red button labeled Run.",
  });
  assert.ok(fence.startsWith(`<${FENCE_TAG} index="2" filename="shot.png">`));
  assert.ok(fence.endsWith(`</${FENCE_TAG}>`));
  assert.ok(fence.includes("A red button labeled Run."));
});

test("buildDescriptionFence omits the filename attribute when empty", () => {
  const fence = buildDescriptionFence({ index: 1, description: "x" });
  assert.ok(fence.startsWith(`<${FENCE_TAG} index="1">`));
  assert.ok(!fence.includes("filename="));
});

test("buildDescriptionFence escapes special chars in the filename attribute", () => {
  const fence = buildDescriptionFence({
    index: 1,
    filename: 'weird "name" <&>.png',
    description: "ok",
  });
  assert.ok(fence.includes('filename="weird &quot;name&quot; &lt;&amp;&gt;.png"'));
  assert.ok(!fence.includes('<weird'));
});

test("buildDescriptionFence shows an error placeholder when description failed", () => {
  const fence = buildDescriptionFence({
    index: 3,
    filename: "bad.png",
    description: null,
    error: "vision model returned no content",
  });
  assert.ok(fence.includes("[analysis failed: vision model returned no content]"));
  assert.ok(!fence.includes("[analysis returned no content]"));
});

test("buildDescriptionFence shows an empty placeholder when description is null with no error", () => {
  const fence = buildDescriptionFence({ index: 1, description: null });
  assert.ok(fence.includes("[analysis returned no content]"));
});

test("buildDescriptionFence neutralizes an embedded close tag in the description", () => {
  const fence = buildDescriptionFence({
    index: 1,
    description: `screen shows </${FENCE_TAG}> and more`,
  });
  // The body must not contain a literal close tag that could prematurely close.
  const closeTag = `</${FENCE_TAG}>`;
  // There should be exactly one literal close tag (the real footer).
  assert.equal((fence.match(new RegExp(closeTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1);
});

test("buildDescriptionFence neutralizes an embedded close tag inside an error message", () => {
  const fence = buildDescriptionFence({
    index: 1,
    description: null,
    error: `boom </${FENCE_TAG}>`,
  });
  const closeTag = `</${FENCE_TAG}>`;
  assert.equal((fence.match(new RegExp(closeTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1);
});

// ── isImageBlock / contentHasImages ────────────────────────────────────────

test("isImageBlock identifies image blocks structurally", () => {
  assert.equal(isImageBlock({ type: "image", data: "x", mimeType: "image/png" }), true);
  assert.equal(isImageBlock({ type: "text", text: "hi" }), false);
  assert.equal(isImageBlock(null), false);
  assert.equal(isImageBlock("image"), false);
  assert.equal(isImageBlock({}), false);
});

test("contentHasImages detects image blocks in array content", () => {
  assert.equal(contentHasImages([{ type: "text", text: "hi" }]), false);
  assert.equal(
    contentHasImages([{ type: "text", text: "hi" }, { type: "image", data: "x", mimeType: "image/png" }]),
    true,
  );
});

test("contentHasImages returns false for string content and non-arrays", () => {
  assert.equal(contentHasImages("just text"), false);
  assert.equal(contentHasImages(undefined), false);
  assert.equal(contentHasImages(null), false);
});

// ── replaceImageBlocks ─────────────────────────────────────────────────────

test("replaceImageBlocks replaces each image with a text block built from its hash", () => {
  const content = [
    { type: "text", text: "look:" },
    { type: "image", data: "AAA", mimeType: "image/png" },
    { type: "image", data: "BBB", mimeType: "image/png" },
  ];
  const seen: { hash: string; index: number }[] = [];
  const replaced = replaceImageBlocks(content, (hash, index) => {
    seen.push({ hash, index });
    return `[desc:${hash}:${index}]`;
  }) as unknown[];

  assert.deepEqual(seen, [
    { hash: hashImageData("AAA"), index: 1 },
    { hash: hashImageData("BBB"), index: 2 },
  ]);
  assert.equal(replaced.length, 3);
  assert.deepEqual(replaced[0], { type: "text", text: "look:" });
  assert.equal((replaced[1] as { type: string; text: string }).text, `[desc:${hashImageData("AAA")}:1]`);
  assert.equal((replaced[2] as { type: string; text: string }).text, `[desc:${hashImageData("BBB")}:2]`);
});

test("replaceImageBlocks returns the same reference when there are no image blocks", () => {
  const content = [{ type: "text", text: "plain" }];
  const replaced = replaceImageBlocks(content, () => "x");
  assert.equal(replaced, content);
});

test("replaceImageBlocks returns non-array content untouched", () => {
  assert.equal(replaceImageBlocks("a string", () => "x"), "a string");
  assert.equal(replaceImageBlocks(undefined, () => "x"), undefined);
});

test("replaceImageBlocks preserves non-image block ordering", () => {
  const content = [
    { type: "text", text: "before" },
    { type: "image", data: "X", mimeType: "image/png" },
    { type: "text", text: "after" },
  ];
  const replaced = replaceImageBlocks(content, (_h, i) => `[img:${i}]`) as {
    type: string;
    text?: string;
  }[];
  assert.deepEqual(
    replaced.map((b) => b.type),
    ["text", "text", "text"],
  );
  assert.equal(replaced[0].text, "before");
  assert.equal(replaced[2].text, "after");
  assert.equal(replaced[1].text, "[img:1]");
});

// ── constant sanity ─────────────────────────────────────────────────────────

test("MAX_IMAGE_BYTES is 10 MB", () => {
  assert.equal(MAX_IMAGE_BYTES, 10 * 1024 * 1024);
});