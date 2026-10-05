import test from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { displayFetchUrl, renderWebFetchCall } from "../webfetch.ts";
import { resetToolDisplayState, toggleToolCallsExpanded } from "../../tool-display/state.js";

const theme = { fg: (_role: string, value: string) => value, bold: (value: string) => value };

test("webfetch call shows a safe address before and after execution, at every width", () => {
	resetToolDisplayState();
	const url = `https://example.com/${"long-path-".repeat(20)}?page=2`;
	const call = renderWebFetchCall({ url, format: "html", timeout: 10 }, theme);
	for (const width of [12, 40, 80, 160]) {
		const rows = call.render(width);
		assert.ok(rows.every((row) => visibleWidth(row) <= width));
		assert.ok(rows.join("").includes(url));
		assert.ok(!rows.join("").includes("format:"));
	}
	toggleToolCallsExpanded();
	assert.ok(call.render(80).join("\n").includes("format: html · timeout: 10s"));
	resetToolDisplayState();
});

test("webfetch display handles missing, malformed, and credentialed URLs safely", () => {
	assert.equal(displayFetchUrl(undefined), "(waiting for URL)");
	assert.equal(displayFetchUrl(""), "(waiting for URL)");
	for (const url of ["https://user:password", "https://user:password@", "javascript:alert(1)"]) {
		assert.equal(displayFetchUrl(url), "(invalid URL)");
	}
	assert.ok(!displayFetchUrl("https://user:password@example.com").includes("password"));
	assert.ok(!displayFetchUrl("https://example.com/?api_key=secret&token=private").includes("secret"));
	assert.ok(!displayFetchUrl("https://example.com/?token=private").includes("private"));
	for (const suffix of ["?client_secret=private", "?x-api-key=private", "?X-Amz-Credential=private", "#access_token=private"]) {
		assert.ok(!displayFetchUrl(`https://example.com/${suffix}`).includes("private"));
	}
	assert.equal(displayFetchUrl("https://example.com/\x1b[31m\u202eevil"), "https://example.com/[31mevil");
});

test("webfetch call wraps Unicode paths and does not render injected metadata", () => {
	resetToolDisplayState();
	toggleToolCallsExpanded();
	const call = renderWebFetchCall({ url: "https://example.com/日本語", format: "\x1b[31m", timeout: "\x1b[31m" }, theme);
	for (const width of [12, 40, 80]) {
		const rows = call.render(width);
		assert.ok(rows.every((row) => visibleWidth(row) <= width));
		assert.ok(!rows.join("").includes("\x1b"));
	}
	resetToolDisplayState();
});
