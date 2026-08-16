import { decodeTextBuffer, isAbortError, parseContentType, readBodyWithLimit } from "../network.ts";
import { err, ok, type Result } from "../result.ts";
import type { PublicHttpUrl } from "../types.ts";

export const MAX_SEARCH_RESPONSE_BYTES = 1 * 1024 * 1024;

export interface HttpJsonRequest {
	readonly url: PublicHttpUrl;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: unknown;
	readonly maxResponseBytes: number;
}

export interface HttpTextResponse {
	readonly status: number;
	readonly statusText: string;
	readonly headers: Headers;
	readonly bodyText: string;
	readonly bytes: number;
}

export type HttpClientError =
	| { readonly _tag: "HttpRequestFailed"; readonly cause: unknown }
	| { readonly _tag: "HttpResponseTooLarge"; readonly maxBytes: number }
	| { readonly _tag: "HttpCancelled"; readonly cause?: unknown };

export interface HttpTextClient {
	postJson(request: HttpJsonRequest, options?: { readonly signal?: AbortSignal }): Promise<Result<HttpTextResponse, HttpClientError>>;
}

export class FetchHttpTextClient implements HttpTextClient {
	async postJson(request: HttpJsonRequest, options: { readonly signal?: AbortSignal } = {}): Promise<Result<HttpTextResponse, HttpClientError>> {
		try {
			const response = await fetch(request.url, {
				method: "POST",
				headers: request.headers,
				body: JSON.stringify(request.body),
				signal: options.signal,
			});
			const contentLength = response.headers.get("content-length");
			if (contentLength && Number.parseInt(contentLength, 10) > request.maxResponseBytes) {
				await response.body?.cancel().catch(() => undefined);
				return err({ _tag: "HttpResponseTooLarge", maxBytes: request.maxResponseBytes });
			}
			const body = await readBodyWithLimit(response, request.maxResponseBytes, options.signal);
			const decoded = decodeTextBuffer(body.buffer, parseContentType(response.headers.get("content-type")).charset);
			return ok({ status: response.status, statusText: response.statusText, headers: response.headers, bodyText: decoded.text, bytes: body.bytes });
		} catch (cause: unknown) {
			if (options.signal?.aborted || isAbortError(cause)) return err({ _tag: "HttpCancelled", cause });
			if (cause instanceof Error && cause.message.startsWith("Response too large")) return err({ _tag: "HttpResponseTooLarge", maxBytes: request.maxResponseBytes });
			return err({ _tag: "HttpRequestFailed", cause });
		}
	}
}
