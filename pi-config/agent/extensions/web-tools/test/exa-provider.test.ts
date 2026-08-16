import assert from "node:assert/strict";
import test from "node:test";
import { err, ok, type Result } from "../result.ts";
import { ExaSearchProvider } from "../providers/exa.ts";
import {
	MAX_SEARCH_RESPONSE_BYTES,
	type HttpClientError,
	type HttpJsonRequest,
	type HttpTextClient,
	type HttpTextResponse,
} from "../providers/http.ts";
import { parsePublicHttpUrl, parseSearchQuery } from "../types.ts";

class RecordingHttpTextClient implements HttpTextClient {
	readonly requests: HttpJsonRequest[] = [];
	constructor(private readonly response: Result<HttpTextResponse, HttpClientError>) {}
	async postJson(request: HttpJsonRequest): Promise<Result<HttpTextResponse, HttpClientError>> {
		this.requests.push(request);
		return this.response;
	}
}

const endpoint = expectUrl("https://api.exa.ai/search");
const query = expectQuery("example");
const response = (body: unknown): Result<HttpTextResponse, HttpClientError> => ok({
	status: 200,
	statusText: "OK",
	headers: new Headers({ "content-type": "application/json" }),
	bodyText: JSON.stringify(body),
	bytes: 100,
});

test("ExaSearchProvider requires EXA_API_KEY without leaking credentials", async () => {
	const http = new RecordingHttpTextClient(response({ results: [] }));
	const result = await new ExaSearchProvider(endpoint, http).search({ query, maxResults: 5, depth: "auto" });
	assert.deepEqual(result, { _tag: "err", error: { _tag: "SearchProviderReturnedError", provider: "exa", safeMessage: "websearch is unavailable: EXA_API_KEY is not set." } });
	assert.equal(http.requests.length, 0);
});

test("ExaSearchProvider sends structured requests and normalizes bounded results", async () => {
	const http = new RecordingHttpTextClient(response({
		results: [
			{ title: "Example", url: "https://example.com/", text: "  Useful text  ", publishedDate: "2026-01-01", score: 0.8 },
			{ title: "Ignored", url: "mailto:test@example.com" },
		],
	}));
	const result = await new ExaSearchProvider(endpoint, http, "secret").search({ query, maxResults: 1, depth: "deep" });
	assert.deepEqual(result, { _tag: "ok", value: [{ title: "Example", url: "https://example.com/", snippet: "Useful text", publishedAt: "2026-01-01", score: 0.8 }] });
	assert.deepEqual(http.requests[0], {
		url: endpoint,
		headers: { accept: "application/json", "content-type": "application/json", "x-api-key": "secret" },
		body: { query, numResults: 1, type: "deep", contents: { text: { maxCharacters: 2000 } } },
		maxResponseBytes: MAX_SEARCH_RESPONSE_BYTES,
	});
});

test("ExaSearchProvider accepts empty results and rejects invalid payloads", async () => {
	const empty = await new ExaSearchProvider(endpoint, new RecordingHttpTextClient(response({ results: [] })), "key").search({ query, maxResults: 5, depth: "fast" });
	assert.deepEqual(empty, { _tag: "ok", value: [] });
	const invalid = await new ExaSearchProvider(endpoint, new RecordingHttpTextClient(response({ nope: [] })), "key").search({ query, maxResults: 5, depth: "fast" });
	assert.deepEqual(invalid, { _tag: "err", error: { _tag: "SearchProviderProtocolInvalid", provider: "exa", reason: "Missing results array" } });
});

test("ExaSearchProvider maps cancellation and response limits", async () => {
	const cancelled = await new ExaSearchProvider(endpoint, new RecordingHttpTextClient(err({ _tag: "HttpCancelled" })), "key").search({ query, maxResults: 5, depth: "auto" });
	assert.equal(cancelled._tag, "err");
	assert.equal(cancelled.error._tag, "SearchProviderCancelled");
	const tooLarge = await new ExaSearchProvider(endpoint, new RecordingHttpTextClient(err({ _tag: "HttpResponseTooLarge", maxBytes: MAX_SEARCH_RESPONSE_BYTES })), "key").search({ query, maxResults: 5, depth: "auto" });
	assert.deepEqual(tooLarge, { _tag: "err", error: { _tag: "SearchProviderResponseTooLarge", provider: "exa", maxBytes: MAX_SEARCH_RESPONSE_BYTES } });
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
