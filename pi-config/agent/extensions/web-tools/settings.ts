import { Redacted } from "./redacted.ts";
import {
	parsePublicHttpUrl,
	type PublicHttpUrl,
	type SearchDepth,
	type SearchProviderName,
	type WebFetchFormat,
	type WebToolsSettings,
} from "./types.ts";

export const WEB_FETCH_FORMATS = ["markdown", "text", "html"] as const satisfies readonly WebFetchFormat[];
export const SEARCH_DEPTHS = ["auto", "fast", "deep"] as const satisfies readonly SearchDepth[];
export const SEARCH_PROVIDERS = ["exa", "parallel"] as const satisfies readonly SearchProviderName[];

export const FETCH_TIMEOUT_SECONDS = { default: 30, min: 1, max: 120 } as const;
export const SEARCH_TIMEOUT_SECONDS = { default: 25, min: 1, max: 120 } as const;
export const SEARCH_MAX_RESULTS = { default: 8, min: 1, max: 20 } as const;
export const FETCH_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const FETCH_MAX_REDIRECTS = 5;

export const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";
export const PARALLEL_SEARCH_ENDPOINT = "https://api.parallel.ai/v1/search";

export type ToolInputParseError =
	| { readonly _tag: "InvalidToolInput"; readonly message: string }
	| { readonly _tag: "InvalidToolField"; readonly field: string; readonly message: string }
	| { readonly _tag: "UnknownToolField"; readonly field: string };

const DEFAULTS = {
	fetchDefaultFormat: "markdown",
	fetchTimeoutSeconds: FETCH_TIMEOUT_SECONDS.default,
	fetchMaxResponseBytes: FETCH_MAX_RESPONSE_BYTES,
	fetchBlockPrivateHosts: true,
	fetchMaxRedirects: FETCH_MAX_REDIRECTS,
	fetchFallbackUserAgent: "opencode",
	searchEnabled: true,
	searchProvider: "exa",
	searchTimeoutSeconds: SEARCH_TIMEOUT_SECONDS.default,
	searchDefaultMaxResults: SEARCH_MAX_RESULTS.default,
	searchDefaultDepth: "auto",
} as const;

/** Clamp a finite number to an inclusive integer range. */
export function clampInteger(value: number, bounds: { readonly min: number; readonly max: number; readonly fallback: number }): number {
	return Number.isFinite(value) ? Math.max(bounds.min, Math.min(bounds.max, Math.round(value))) : bounds.fallback;
}

export function parseOnOff(value: string | undefined, fallback: boolean): boolean {
	if (!value) return fallback;
	const normalized = value.trim().toLowerCase();
	return normalized === "on" ? true : normalized === "off" ? false : fallback;
}

export function parseIntegerSetting(value: string | undefined, fallback: number, options: { min?: number; max?: number } = {}): number {
	const parsed = Number.parseInt(value?.trim() ?? "", 10);
	if (!Number.isFinite(parsed)) return fallback;
	if (options.min !== undefined && parsed < options.min) return fallback;
	if (options.max !== undefined && parsed > options.max) return fallback;
	return parsed;
}

export function parseEnumSetting<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
	const normalized = value?.trim() as T | undefined;
	return normalized && allowed.includes(normalized) ? normalized : fallback;
}

/** Build settings from stable defaults and optional WEB_TOOLS_* environment overrides. */
export function getWebToolsSettings(env: NodeJS.ProcessEnv = process.env): WebToolsSettings {
	const provider = parseEnumSetting(env.WEB_TOOLS_SEARCH_PROVIDER, SEARCH_PROVIDERS, DEFAULTS.searchProvider);
	const searchBase = {
		enabled: parseOnOff(env.WEB_TOOLS_SEARCH_ENABLED, DEFAULTS.searchEnabled),
		timeoutSeconds: parseIntegerSetting(env.WEB_TOOLS_SEARCH_TIMEOUT_SECONDS, DEFAULTS.searchTimeoutSeconds, SEARCH_TIMEOUT_SECONDS),
		defaultMaxResults: parseIntegerSetting(env.WEB_TOOLS_SEARCH_DEFAULT_MAX_RESULTS, DEFAULTS.searchDefaultMaxResults, SEARCH_MAX_RESULTS),
		defaultDepth: parseEnumSetting(env.WEB_TOOLS_SEARCH_DEFAULT_DEPTH, SEARCH_DEPTHS, DEFAULTS.searchDefaultDepth),
	};

	return {
		fetch: {
			defaultFormat: parseEnumSetting(env.WEB_TOOLS_FETCH_DEFAULT_FORMAT, WEB_FETCH_FORMATS, DEFAULTS.fetchDefaultFormat),
			timeoutSeconds: parseIntegerSetting(env.WEB_TOOLS_FETCH_TIMEOUT_SECONDS, DEFAULTS.fetchTimeoutSeconds, FETCH_TIMEOUT_SECONDS),
			maxResponseBytes: parseIntegerSetting(env.WEB_TOOLS_FETCH_MAX_RESPONSE_BYTES, DEFAULTS.fetchMaxResponseBytes, { min: 1 }),
			blockPrivateHosts: parseOnOff(env.WEB_TOOLS_FETCH_BLOCK_PRIVATE_HOSTS, DEFAULTS.fetchBlockPrivateHosts),
			maxRedirects: parseIntegerSetting(env.WEB_TOOLS_FETCH_MAX_REDIRECTS, DEFAULTS.fetchMaxRedirects, { min: 0 }),
			fallbackUserAgent: env.WEB_TOOLS_FETCH_FALLBACK_USER_AGENT?.trim() || DEFAULTS.fetchFallbackUserAgent,
		},
		search:
			provider === "exa"
				? { ...searchBase, provider, endpoint: readEndpoint(env.WEB_TOOLS_SEARCH_ENDPOINT ?? env.WEB_TOOLS_EXA_ENDPOINT, EXA_SEARCH_ENDPOINT), apiKey: readApiKey(env.EXA_API_KEY) }
				: { ...searchBase, provider, endpoint: readEndpoint(env.WEB_TOOLS_SEARCH_ENDPOINT ?? env.WEB_TOOLS_PARALLEL_ENDPOINT, PARALLEL_SEARCH_ENDPOINT), apiKey: readApiKey(env.PARALLEL_API_KEY) },
	};
}

function readApiKey(value: string | undefined): ReturnType<typeof Redacted.make<string>> | undefined {
	const key = value?.trim();
	return key ? Redacted.make(key) : undefined;
}

function readEndpoint(value: string | undefined, fallback: string): PublicHttpUrl {
	const parsed = parsePublicHttpUrl(value?.trim() || fallback);
	if (parsed._tag === "ok") return parsed.value;
	return mustParsePublicHttpUrl(fallback);
}

function mustParsePublicHttpUrl(input: string): PublicHttpUrl {
	const parsed = parsePublicHttpUrl(input);
	if (parsed._tag === "err") throw new Error("Invalid built-in web-tools endpoint");
	return parsed.value;
}
