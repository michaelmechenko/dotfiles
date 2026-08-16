import test from "node:test";
import assert from "node:assert/strict";
import {
	EXA_SEARCH_ENDPOINT,
	PARALLEL_SEARCH_ENDPOINT,
	getWebToolsSettings,
	parseEnumSetting,
	parseIntegerSetting,
	parseOnOff,
} from "../settings.ts";
import { Redacted } from "../redacted.ts";

test("parseOnOff accepts on/off and falls back safely", () => {
	assert.equal(parseOnOff("on", false), true);
	assert.equal(parseOnOff("off", true), false);
	assert.equal(parseOnOff("bogus", true), true);
	assert.equal(parseOnOff(undefined, false), false);
});

test("parseIntegerSetting validates integer ranges", () => {
	assert.equal(parseIntegerSetting("30", 10, { min: 1, max: 120 }), 30);
	assert.equal(parseIntegerSetting("0", 10, { min: 1, max: 120 }), 10);
	assert.equal(parseIntegerSetting("121", 10, { min: 1, max: 120 }), 10);
	assert.equal(parseIntegerSetting("not-a-number", 10, { min: 1, max: 120 }), 10);
});

test("parseEnumSetting validates allowed values", () => {
	assert.equal(parseEnumSetting("markdown", ["markdown", "text", "html"], "text"), "markdown");
	assert.equal(parseEnumSetting("pdf", ["markdown", "text", "html"], "text"), "text");
	assert.equal(parseEnumSetting(undefined, ["markdown", "text", "html"], "text"), "text");
});

test("getWebToolsSettings uses stable Exa defaults and redacts credentials", () => {
	const settings = getWebToolsSettings({ EXA_API_KEY: "exa-secret" });
	assert.equal(settings.search.provider, "exa");
	assert.equal(settings.search.endpoint, EXA_SEARCH_ENDPOINT);
	assert.equal(String(settings.search.apiKey), "<redacted>");
	assert.equal(Redacted.value(settings.search.apiKey!), "exa-secret");
});

test("getWebToolsSettings selects Parallel and applies scoped environment overrides", () => {
	const settings = getWebToolsSettings({
		WEB_TOOLS_SEARCH_PROVIDER: "parallel",
		WEB_TOOLS_SEARCH_ENDPOINT: "https://parallel.example/search",
		PARALLEL_API_KEY: "parallel-secret",
		WEB_TOOLS_FETCH_TIMEOUT_SECONDS: "45",
		WEB_TOOLS_SEARCH_DEFAULT_DEPTH: "deep",
	});
	assert.equal(settings.fetch.timeoutSeconds, 45);
	assert.equal(settings.search.provider, "parallel");
	assert.equal(settings.search.endpoint, "https://parallel.example/search");
	assert.equal(settings.search.defaultDepth, "deep");
	assert.equal(Redacted.value(settings.search.apiKey!), "parallel-secret");
});

test("getWebToolsSettings ignores invalid provider endpoints", () => {
	const settings = getWebToolsSettings({ WEB_TOOLS_SEARCH_PROVIDER: "parallel", WEB_TOOLS_PARALLEL_ENDPOINT: "file:///private" });
	assert.equal(settings.search.provider, "parallel");
	assert.equal(settings.search.endpoint, PARALLEL_SEARCH_ENDPOINT);
});
