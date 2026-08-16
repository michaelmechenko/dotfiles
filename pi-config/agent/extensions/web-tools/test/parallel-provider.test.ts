import assert from "node:assert/strict";
import test from "node:test";
import { err, ok, type Result } from "../result.ts";
import { MAX_SEARCH_RESPONSE_BYTES, type HttpClientError, type HttpJsonRequest, type HttpTextClient, type HttpTextResponse } from "../providers/http.ts";
import { ParallelSearchProvider } from "../providers/parallel.ts";
import { parsePublicHttpUrl, parseSearchQuery } from "../types.ts";

class RecordingHttpTextClient implements HttpTextClient {
	readonly requests: HttpJsonRequest[] = [];
	constructor(private readonly response: Result<HttpTextResponse, HttpClientError>) {}
	async postJson(request: HttpJsonRequest): Promise<Result<HttpTextResponse, HttpClientError>> {
		this.requests.push(request);
		return this.response;
	}
}

const endpoint = expectUrl("https://api.parallel.ai/v1/search");
const query = expectQuery("parallel example");
const response = (body: unknown): Result<HttpTextResponse, HttpClientError> => ok({ status: 200, statusText: "OK", headers: new Headers(), bodyText: JSON.stringify(body), bytes: 100 });
const validBody = {
	search_id: "search-1",
	session_id: "session-1",
	results: [
		{ title: "Parallel", url: "https://example.com/article", excerpts: [" First excerpt ", "Second excerpt"], publish_date: "2026-02-01" },
		{ url: "https://example.com/second", excerpts: [] },
	],
};

test("ParallelSearchProvider supports anonymous structured requests", async () => {
	const http = new RecordingHttpTextClient(response(validBody));
	const result = await new ParallelSearchProvider(endpoint, http).search({ query, maxResults: 1, depth: "fast" });
	assert.deepEqual(result, { _tag: "ok", value: [{ title: "Parallel", url: "https://example.com/article", snippet: "First excerpt\n\nSecond excerpt", publishedAt: "2026-02-01" }] });
	assert.deepEqual(http.requests[0], {
		url: endpoint,
		headers: { accept: "application/json", "content-type": "application/json" },
		body: { search_queries: [query], objective: query, mode: "fast", advanced_settings: { max_results: 1 } },
		maxResponseBytes: MAX_SEARCH_RESPONSE_BYTES,
	});
});

test("ParallelSearchProvider adds optional Bearer credentials and maps deep to advanced", async () => {
	const http = new RecordingHttpTextClient(response(validBody));
	await new ParallelSearchProvider(endpoint, http, "secret").search({ query, maxResults: 2, depth: "deep" });
	assert.equal(http.requests[0]?.headers.authorization, "Bearer secret");
	assert.equal((http.requests[0]?.body as { mode: string }).mode, "advanced");
});

test("ParallelSearchProvider rejects invalid payloads", async () => {
	const result = await new ParallelSearchProvider(endpoint, new RecordingHttpTextClient(response({ results: [] }))).search({ query, maxResults: 5, depth: "auto" });
	assert.deepEqual(result, { _tag: "err", error: { _tag: "SearchProviderProtocolInvalid", provider: "parallel", reason: "Missing search response fields" } });
});

test("ParallelSearchProvider maps cancellation and response limits", async () => {
	const cancelled = await new ParallelSearchProvider(endpoint, new RecordingHttpTextClient(err({ _tag: "HttpCancelled" }))).search({ query, maxResults: 5, depth: "auto" });
	assert.equal(cancelled._tag, "err");
	assert.equal(cancelled.error._tag, "SearchProviderCancelled");
	const tooLarge = await new ParallelSearchProvider(endpoint, new RecordingHttpTextClient(err({ _tag: "HttpResponseTooLarge", maxBytes: MAX_SEARCH_RESPONSE_BYTES }))).search({ query, maxResults: 5, depth: "auto" });
	assert.deepEqual(tooLarge, { _tag: "err", error: { _tag: "SearchProviderResponseTooLarge", provider: "parallel", maxBytes: MAX_SEARCH_RESPONSE_BYTES } });
});

function expectUrl(value: string) {
	const parsed = parsePublicHttpUrl(value);
	assert.equal(parsed._tag, "ok");
	return parsed.value;
}
function expectQuery(value: string) {
	const parsed = parseSearchQuery(value);
	assert.equal(parsed._tag, "ok");
	return parsed.value;
}
