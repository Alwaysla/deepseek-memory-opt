# `@deepseek-ai/dsh-web-search-tavily`

English | [中文](README.zh.md)

Tavily search provider for the provider-neutral [`ctx.web`](../web) service.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `apiKey` | unset | Literal API key. Prefer a credential reference. |
| `apiKeyEnv` | `TAVILY_API_KEY` | Credential reference resolved for every search. |
| `baseURL` | `https://api.tavily.com` | API base URL; the provider calls `/search`. |
| `searchDepth` | `basic` | Tavily `basic` or `advanced` search depth. |
| `includeAnswer` | `true` | Request Tavily's synthesized answer. |
| `maxResults` | unset | Default result count when the caller does not provide one. |

The provider sends credentials only to the configured endpoint and rejects redirects. Credentials may come from `ctx.credentials` or the launching environment and are resolved for each operation, so rotation takes effect without remounting the plugin.

## Model Experience

- **Prompt impact:** none; [`dsh-tool-web`](../tool-web) owns the stable `web_search` schema.
- **Tool impact:** Tavily supplies normalized answer text and citeable sources through `web_search` when selected by `ctx.web`.
- **Token impact:** result size follows the shared web seam's `maxResults` limit; Tavily answer and snippets consume model context.
- **KV-cache impact:** none beyond the ordinary tool result already logged by the tool consumer.

## Known Limitations and Deferred Work

Tavily search does not implement page fetching. Mount a fetch provider separately when `web_fetch` is required.
