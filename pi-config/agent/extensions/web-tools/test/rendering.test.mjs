import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { jiti, root } from "../../test-runtime.mjs";

const sdk = await import(pathToFileURL(resolve(root, "dist/index.js")).href);
const tui = await jiti.import("@earendil-works/pi-tui");
const { createWebFetchTool } = await jiti.import(resolve(import.meta.dirname, "../webfetch.ts"));
const { installHostDecorator } = await jiti.import(resolve(import.meta.dirname, "../../tool-display/host-decorator.ts"));
const state = await jiti.import(resolve(import.meta.dirname, "../../tool-display/state.ts"));
sdk.initTheme("dark", false);
installHostDecorator();

function component(args) {
	return new sdk.ToolExecutionComponent("webfetch", "fetch-fixture", args, { showImages: false }, createWebFetchTool(), { requestRender() {} }, process.cwd());
}

function render(card, width) {
	const rows = card.render(width);
	assert.ok(rows.every((row) => tui.visibleWidth(row) <= width), `overflow at ${width}`);
	return rows.map(tui.stripTerminalSequences);
}

test("actual host cards retain the fetch URL, status, and one divider across display states", () => {
	const url = "https://example.com/" + "long-path-".repeat(18);
	for (const width of [24, 40, 80, 160]) {
		for (const callsExpanded of [false, true]) {
			for (const resultsExpanded of [false, true]) {
				for (const wrapped of [false, true]) {
					state.resetToolDisplayState();
					if (callsExpanded) state.toggleToolCallsExpanded();
					if (!wrapped) state.toggleToolOutputWrap();
					const card = component({ url, format: "html" });
					card.setExpanded(resultsExpanded);
					for (const status of ["pending", "streaming", "success", "error", "cancelled", "image"]) {
						if (status !== "pending") {
							const content = status === "image"
								? [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=" }]
								: [{ type: "text", text: status === "cancelled" ? "Web fetch cancelled" : "Fixture result\n" + "text ".repeat(30) }];
							card.updateResult({ content, details: {}, isError: ["error", "cancelled"].includes(status) }, status === "streaming");
						}
						const rows = render(card, width);
						const divider = rows.findIndex((row) => /─{3}/.test(row));
						const callRows = (divider < 0 ? rows : rows.slice(0, divider)).filter((row) => row.replace(/^▌/, "").trim());
						const joined = callRows.map((row, index) => {
							const inner = row.replace(/^▌/, "").trim();
							return index === 0 ? inner.slice(2) : inner;
						}).join("");
						assert.ok(joined.includes(url), `${status}: URL missing at ${width}`);
						assert.ok(callRows[0].includes(status === "pending" || status === "streaming" ? "○" : ["error", "cancelled"].includes(status) ? "✗" : "✓"));
						assert.equal(divider >= 0, status !== "pending");
						assert.equal(rows.filter((row) => /─{3}/.test(row)).length, status === "pending" ? 0 : 1);
						if (status === "image") assert.ok(rows.some((row) => row.includes("image/png")));
					}
				}
			}
		}
	}
	state.resetToolDisplayState();
});

test("actual host handles incomplete arguments and redacts credentials", () => {
	assert.ok(render(component({}), 80).join("\n").includes("waiting for URL"));
	const rows = render(component({ url: "https://user:password@example.com" }), 80);
	assert.ok(!rows.join("\n").includes("password"));
});
