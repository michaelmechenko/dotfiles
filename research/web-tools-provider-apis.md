# Web-tools provider APIs

Sources below were fetched from the providers' official documentation domains
(`exa.ai` and `docs.parallel.ai`); the Parallel reference explicitly identifies
`/v1beta/search` as legacy, so this note covers current `/v1/search`.

## Exa Search

- **Endpoint and authentication:** `POST https://api.exa.ai/search`. The current
  OpenAPI declares both `x-api-key: <key>` and bearer schemes; its cURL samples
  use `x-api-key`. The coding-agent guide also documents
  `Authorization: Bearer <key>`. [OpenAPI](https://exa.ai/docs/reference/search.md)
  · [Guide](https://exa.ai/docs/reference/search-api-guide-for-coding-agents.md)
- **Request:** required `query` (non-empty string); `numResults` defaults to
  `10` and is `1`–`100`. `type` defaults to `auto`; values are `instant`,
  `fast`, `auto`, `deep-lite`, `deep`, and `deep-reasoning`. Respectively, the
  types progress from minimum latency through balanced/fast search to
  lightweight or comprehensive multi-step research and stronger reasoning.
  [OpenAPI](https://exa.ai/docs/reference/search.md)
- **Response:** ordinary JSON requires `results: SearchResult[]`; each result
  may contain `title`, `url`, `id`, metadata, and requested `text`,
  `highlights`, or `summary`. It may also contain `requestId`, `costDollars`,
  and deprecated `resolvedSearchType` (do not branch on it). Supplying
  `outputSchema` adds required `output: { content, grounding[] }`, where
  `content` is text or the requested object and each grounding item has
  `field`, `citations[]`, and `confidence`. [OpenAPI](https://exa.ai/docs/reference/search.md)

## Parallel Search

- **Endpoint and authentication:** `POST https://api.parallel.ai/v1/search`;
  use `x-api-key: <key>`. This is the current endpoint; the official reference
  labels `/v1beta/search` legacy. [OpenAPI](https://docs.parallel.ai/api-reference/search/search)
- **Request:** required `search_queries: string[]` (at least one); optional
  `objective` supplies the natural-language goal. Result count is
  `advanced_settings.max_results`, default `10`, positive, and currently
  capped at `20` for public modes (larger requests are reduced with a warning).
  [OpenAPI](https://docs.parallel.ai/api-reference/search/search) ·
  [Advanced settings](https://docs.parallel.ai/search/advanced-search-settings)
- **Depth/type semantics:** there is no depth field. `mode` defaults to
  `advanced`; allowed modes are `turbo` (lowest latency/cost), `fast`
  (high-quality, sub-second target), `basic` (quick retrieval), and `advanced`
  (higher-quality retrieval and compression for multi-hop work).
  [Modes](https://docs.parallel.ai/search/modes)
- **Response:** JSON requires `{ search_id, results, session_id }`; optional
  `warnings` and `usage` are arrays. Results are decreasing-relevance entries
  requiring `{ url, excerpts: string[] }`, with optional `title` and
  `publish_date`; excerpts are Markdown. [OpenAPI](https://docs.parallel.ai/api-reference/search/search)
