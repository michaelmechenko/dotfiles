import { Type } from "typebox";
import { Value } from "typebox/value";
import { err, ok, type Result } from "../result.ts";
import { parsePublicHttpUrl, type NormalizedSearchResult, type PublicHttpUrl } from "../types.ts";
import type { SearchProvider, SearchProviderError, SearchProviderRequest } from "./types.ts";
import { MAX_SEARCH_RESPONSE_BYTES, type HttpClientError, type HttpTextClient } from "./http.ts";

const ExaResponse = Type.Object({
	results: Type.Array(Type.Object({
		url: Type.String(),
		title: Type.Optional(Type.String()),
		text: Type.Optional(Type.String()),
		publishedDate: Type.Optional(Type.String()),
	score: Type.Optional(Type.Number()),
	})),
});

export class ExaSearchProvider implements SearchProvider {
	readonly name = "exa" as const;

	constructor(private readonly endpoint: PublicHttpUrl, private readonly http: HttpTextClient, private readonly apiKey?: string) {}

	async search(input: SearchProviderRequest, options: { readonly signal?: AbortSignal } = {}): Promise<Result<readonly NormalizedSearchResult[], SearchProviderError>> {
		if (!this.apiKey) {
			return err({ _tag: "SearchProviderReturnedError", provider: this.name, safeMessage: "websearch is unavailable: EXA_API_KEY is not set." });
		}
		const response = await this.http.postJson({
			url: this.endpoint,
			headers: { accept: "application/json", "content-type": "application/json", "x-api-key": this.apiKey },
			body: { query: input.query, numResults: input.maxResults, type: mapExaDepth(input.depth), contents: { text: { maxCharacters: 2000 } } },
			maxResponseBytes: MAX_SEARCH_RESPONSE_BYTES,
		}, { signal: options.signal });
		if (response._tag === "err") return err(mapHttpClientError(this.name, response.error));
		if (response.value.status < 200 || response.value.status >= 300) return err({ _tag: "SearchProviderStatusRejected", provider: this.name, status: response.value.status });

		const payload = parseExaResponse(response.value.bodyText);
		if (!payload) return err({ _tag: "SearchProviderProtocolInvalid", provider: this.name, reason: "Missing results array" });
		return ok(payload.results.flatMap(normalizeExaResult).slice(0, input.maxResults));
	}
}

export function mapExaDepth(depth: SearchProviderRequest["depth"]): "auto" | "fast" | "deep" {
	return depth;
}

function parseExaResponse(body: string): { readonly results: readonly { readonly url: string; readonly title?: string; readonly text?: string; readonly publishedDate?: string; readonly score?: number }[] } | undefined {
	try {
		const value: unknown = JSON.parse(body);
		return Value.Check(ExaResponse, value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function normalizeExaResult(result: { readonly url: string; readonly title?: string; readonly text?: string; readonly publishedDate?: string; readonly score?: number }): readonly NormalizedSearchResult[] {
	const url = parsePublicHttpUrl(result.url);
	if (url._tag === "err") return [];
	return [{ title: result.title?.trim() || url.value, url: url.value, snippet: nonEmpty(result.text), publishedAt: nonEmpty(result.publishedDate), score: result.score }];
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

function mapHttpClientError(provider: "exa", error: HttpClientError): SearchProviderError {
	switch (error._tag) {
		case "HttpRequestFailed": return { _tag: "SearchProviderUnavailable", provider, cause: error.cause };
		case "HttpResponseTooLarge": return { _tag: "SearchProviderResponseTooLarge", provider, maxBytes: error.maxBytes };
		case "HttpCancelled": return { _tag: "SearchProviderCancelled", provider, cause: error.cause };
	}
}
