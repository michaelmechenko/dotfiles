import { Redacted, type Redacted as RedactedValue } from "./redacted.ts";
import { err, ok, type Result } from "./result.ts";

export const WEB_TOOLS_EXTENSION_NAME = "web-tools";

/** A public HTTP(S) URL accepted by web-tools. */
export type PublicHttpUrl = string & { readonly __brand: "PublicHttpUrl" };

/** A non-empty, trimmed search query. */
export type SearchQuery = string & { readonly __brand: "SearchQuery" };

export type WebFetchFormat = "markdown" | "text" | "html";
export type SearchDepth = "auto" | "fast" | "deep";
export type SearchProviderName = "exa" | "parallel";
export type ContentKind = "html" | "text" | "raster-image" | "svg" | "binary";

export type ParsePublicHttpUrlError =
	| { readonly _tag: "EmptyUrl" }
	| { readonly _tag: "UnsupportedUrlProtocol"; readonly protocol?: string }
	| { readonly _tag: "InvalidUrl"; readonly input: RedactedValue<string> }
	| { readonly _tag: "UrlCredentialsUnsupported"; readonly url: RedactedValue<string> };

export type ParseSearchQueryError = { readonly _tag: "EmptySearchQuery" };

export interface WebFetchSettings {
	readonly defaultFormat: WebFetchFormat;
	readonly timeoutSeconds: number;
	readonly maxResponseBytes: number;
	readonly blockPrivateHosts: boolean;
	readonly maxRedirects: number;
	readonly fallbackUserAgent: string;
}

interface SearchSettingsBase {
	readonly enabled: boolean;
	readonly timeoutSeconds: number;
	readonly defaultMaxResults: number;
	readonly defaultDepth: SearchDepth;
}

export type SearchSettings =
	| (SearchSettingsBase & {
			readonly provider: "exa";
			readonly endpoint: PublicHttpUrl;
			readonly apiKey?: RedactedValue<string>;
		})
	| (SearchSettingsBase & {
			readonly provider: "parallel";
			readonly endpoint: PublicHttpUrl;
			readonly apiKey?: RedactedValue<string>;
		});

export interface WebToolsSettings {
	readonly fetch: WebFetchSettings;
	readonly search: SearchSettings;
}

export interface ParsedContentType {
	readonly contentType: string;
	readonly mime: string;
	readonly charset?: string;
	readonly kind: ContentKind;
}

export interface WebFetchDetails {
	readonly requestedUrl: string;
	readonly finalUrl: string;
	readonly format: WebFetchFormat;
	readonly status: number;
	readonly mime: string;
	readonly contentType: string;
	readonly charset?: string;
	readonly decoder?: string;
	readonly bytes: number;
	readonly image?: boolean;
	readonly truncated?: boolean;
	readonly fullOutputPath?: string;
}

export interface NormalizedSearchResult {
	readonly title: string;
	readonly url: PublicHttpUrl;
	readonly snippet?: string;
	readonly publishedAt?: string;
	readonly source?: string;
	readonly score?: number;
}

export interface WebSearchDetails {
	readonly query: string;
	readonly depth: SearchDepth;
	readonly maxResults: number;
	readonly provider: SearchProviderName;
	readonly resultCount: number;
	readonly truncated?: boolean;
	readonly fullOutputPath?: string;
	readonly results: readonly NormalizedSearchResult[];
}

/** Parse and normalize a public HTTP(S) URL from boundary input. */
export function parsePublicHttpUrl(input: string): Result<PublicHttpUrl, ParsePublicHttpUrlError> {
	const trimmed = input.trim();
	if (!trimmed) return err({ _tag: "EmptyUrl" });

	const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
	const protocol = schemeMatch?.[1]?.toLowerCase();
	const normalized = trimmed.toLowerCase();
	if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
		return err(protocol ? { _tag: "UnsupportedUrlProtocol", protocol: `${protocol}:` } : { _tag: "UnsupportedUrlProtocol" });
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return err({ _tag: "InvalidUrl", input: Redacted.make(trimmed) });
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return err({ _tag: "UnsupportedUrlProtocol", protocol: url.protocol });
	if (url.username || url.password) return err({ _tag: "UrlCredentialsUnsupported", url: Redacted.make(url.toString()) });
	return ok(url.toString() as PublicHttpUrl);
}

/** Parse and trim a non-empty search query from boundary input. */
export function parseSearchQuery(input: string): Result<SearchQuery, ParseSearchQueryError> {
	const query = input.trim();
	return query ? ok(query as SearchQuery) : err({ _tag: "EmptySearchQuery" });
}

/** Format URL-like UI text without exposing URL userinfo credentials. */
export function redactUrlCredentialsForDisplay(input: unknown): string {
	const raw = String(input);
	const trimmed = raw.trim();
	if (!trimmed) return raw;
	try {
		const url = new URL(trimmed);
		return url.username || url.password ? String(Redacted.make(trimmed)) : url.toString();
	} catch {
		return looksLikeCredentialedAbsoluteUrl(trimmed) ? String(Redacted.make(trimmed)) : raw;
	}
}

function looksLikeCredentialedAbsoluteUrl(input: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]*@/i.test(input);
}
