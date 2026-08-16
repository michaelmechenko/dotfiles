import { Type } from "typebox";
import { Value } from "typebox/value";
import { err, ok, type Result } from "../result.ts";
import { parsePublicHttpUrl, type NormalizedSearchResult, type PublicHttpUrl } from "../types.ts";
import { MAX_SEARCH_RESPONSE_BYTES, type HttpClientError, type HttpTextClient } from "./http.ts";
import type { SearchProvider, SearchProviderError, SearchProviderRequest } from "./types.ts";

const ParallelResponse = Type.Object({
	search_id: Type.String(),
	session_id: Type.String(),
	results: Type.Array(Type.Object({
		url: Type.String(),
		excerpts: Type.Array(Type.String()),
		title: Type.Optional(Type.String()),
		publish_date: Type.Optional(Type.String()),
	})),
});

export class ParallelSearchProvider implements SearchProvider {
	readonly name = "parallel" as const;

	constructor(private readonly endpoint: PublicHttpUrl, private readonly http: HttpTextClient, private readonly apiKey?: string) {}

	async search(input: SearchProviderRequest, options: { readonly signal?: AbortSignal } = {}): Promise<Result<readonly NormalizedSearchResult[], SearchProviderError>> {
		const response = await this.http.postJson({
			url: this.endpoint,
			headers: {
				accept: "application/json",
				"content-type": "application/json",
				...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
			},
			body: {
				search_queries: [input.query],
				objective: input.query,
				mode: mapParallelDepth(input.depth),
				advanced_settings: { max_results: input.maxResults },
			},
			maxResponseBytes: MAX_SEARCH_RESPONSE_BYTES,
		}, { signal: options.signal });
		if (response._tag === "err") return err(mapHttpClientError(this.name, response.error));
		if (response.value.status < 200 || response.value.status >= 300) return err({ _tag: "SearchProviderStatusRejected", provider: this.name, status: response.value.status });

		const payload = parseParallelResponse(response.value.bodyText);
		if (!payload) return err({ _tag: "SearchProviderProtocolInvalid", provider: this.name, reason: "Missing search response fields" });
		return ok(payload.results.flatMap(normalizeParallelResult).slice(0, input.maxResults));
	}
}

/** Parallel has no depth field: fast stays fast, auto/deep use its higher-quality advanced mode. */
export function mapParallelDepth(depth: SearchProviderRequest["depth"]): "fast" | "advanced" {
	return depth === "fast" ? "fast" : "advanced";
}

function parseParallelResponse(body: string): { readonly results: readonly { readonly url: string; readonly excerpts: readonly string[]; readonly title?: string; readonly publish_date?: string }[] } | undefined {
	try {
		const value: unknown = JSON.parse(body);
		return Value.Check(ParallelResponse, value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function normalizeParallelResult(result: { readonly url: string; readonly excerpts: readonly string[]; readonly title?: string; readonly publish_date?: string }): readonly NormalizedSearchResult[] {
	const url = parsePublicHttpUrl(result.url);
	if (url._tag === "err") return [];
	const snippet = result.excerpts.map((excerpt) => excerpt.trim()).filter(Boolean).join("\n\n") || undefined;
	return [{ title: result.title?.trim() || url.value, url: url.value, snippet, publishedAt: result.publish_date?.trim() || undefined }];
}

function mapHttpClientError(provider: "parallel", error: HttpClientError): SearchProviderError {
	switch (error._tag) {
		case "HttpRequestFailed": return { _tag: "SearchProviderUnavailable", provider, cause: error.cause };
		case "HttpResponseTooLarge": return { _tag: "SearchProviderResponseTooLarge", provider, maxBytes: error.maxBytes };
		case "HttpCancelled": return { _tag: "SearchProviderCancelled", provider, cause: error.cause };
	}
}
