# web-tools

Pi extension that registers two public-web tools:

- `webfetch` — fetch one public URL as markdown, text, html, or an inline raster image
- `websearch` — search the public web through an explicitly selected provider

Tool output uses Pi's default shell and the shared `tool-display/` decorator. This extension does not own a renderer.

## `webfetch`

Parameters:

- `url` — required
- `format` — optional: `markdown`, `text`, `html`
- `timeout` — optional timeout in seconds, clamped to `1..120`

Defaults: markdown, 30 seconds, 5 MB response limit, private-host blocking, five redirects, and the `opencode` Cloudflare fallback user agent.

Only `http://` and `https://` URLs are accepted. Userinfo credentials are rejected and redacted in diagnostics. Raster `png`, `jpeg`, `gif`, and `webp` responses are returned inline; HTML is converted to markdown or text; binary content is rejected.

## `websearch`

Parameters:

- `query` — required
- `maxResults` — optional, clamped to `1..20`
- `depth` — optional: `auto`, `fast`, `deep`

All provider responses are capped at 1 MB. An empty `results` array is a valid successful response.

### Exa (default)

- Endpoint: `https://api.exa.ai/search`
- Credential: required `EXA_API_KEY`, sent as `x-api-key`
- Request: structured JSON with `query`, `numResults`, `type`, and bounded text content
- Depth: `auto`, `fast`, and `deep` map directly to Exa search types

### Parallel (explicit selection only)

- Endpoint: `https://api.parallel.ai/v1/search`
- Credential: optional `PARALLEL_API_KEY`, sent as `Authorization: Bearer …`
- Request: structured JSON with `search_queries`, `objective`, `mode`, and `advanced_settings.max_results`
- Depth: `fast` maps to Parallel `fast`; `auto` and `deep` map to its higher-quality `advanced` mode because Parallel has no depth field

Parallel is never used as an automatic Exa fallback.

## Configuration

Settings are built from stable defaults and optional environment variables. Invalid numeric, enum, or endpoint overrides fall back to the corresponding default.

| Area | Variables |
| --- | --- |
| Fetch | `WEB_TOOLS_FETCH_DEFAULT_FORMAT`, `WEB_TOOLS_FETCH_TIMEOUT_SECONDS`, `WEB_TOOLS_FETCH_MAX_RESPONSE_BYTES`, `WEB_TOOLS_FETCH_BLOCK_PRIVATE_HOSTS`, `WEB_TOOLS_FETCH_MAX_REDIRECTS`, `WEB_TOOLS_FETCH_FALLBACK_USER_AGENT` |
| Search common | `WEB_TOOLS_SEARCH_ENABLED`, `WEB_TOOLS_SEARCH_PROVIDER` (`exa` or `parallel`), `WEB_TOOLS_SEARCH_ENDPOINT`, `WEB_TOOLS_SEARCH_TIMEOUT_SECONDS`, `WEB_TOOLS_SEARCH_DEFAULT_MAX_RESULTS`, `WEB_TOOLS_SEARCH_DEFAULT_DEPTH` |
| Exa | `EXA_API_KEY`, `WEB_TOOLS_EXA_ENDPOINT` |
| Parallel | `PARALLEL_API_KEY`, `WEB_TOOLS_PARALLEL_ENDPOINT` |

`WEB_TOOLS_SEARCH_ENDPOINT` overrides the selected provider's endpoint. Provider credentials are wrapped in `Redacted` values and are not rendered or serialized by the extension.

## Development

Install dependencies with `npm install` in this directory, then run:

```sh
npm run check
```

The package declares the Pi and TypeBox runtime contracts as peers and installs matching versions for local typechecking/tests.

## Source map

- entry: `index.ts`
- settings: `settings.ts`
- fetch service and public client: `fetch-page.ts`, `network.ts`
- search service and Pi adapter: `search-web.ts`, `websearch.ts`
- bounded provider transport: `providers/http.ts`
- structured providers: `providers/exa.ts`, `providers/parallel.ts`
- Pi tool-result projection: `tool-output.ts`
