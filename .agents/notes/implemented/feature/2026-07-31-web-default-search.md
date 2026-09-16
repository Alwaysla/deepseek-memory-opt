# Agent Note: Default Web search in shipped compositions

Status: implemented

English | [中文](2026-07-31-web-default-search.zh.md)

## Problem

The harness has a complete Web capability family—provider registry, multiple search providers, local fetch, stable model tools, and structured result presentation. Shipped compositions need one explicit search implementation so models can discover current information without a deployment overlay. The implementation must use the shared credentials service so keys stored or rotated at runtime take effect on the next request.

## Decision

The base bundle mounts `dsh-web` with `searchProvider: tavily` and mounts `dsh-web-search-tavily` with the `TAVILY_API_KEY` credential reference. Model-facing `dsh-tool-web` rows remain agent-preset owned, while the Host composition owns the shared service and provider registry. The explicit provider id makes selection independent of registration order and allows personal or `--config` overlays to replace or disable the provider.

Tavily resolves its credential for every search through optional `ctx.credentials`, falling back to the launching environment only when the credential service is absent. A non-empty literal `apiKey` remains available for programmatic compositions. Missing credentials fail with `WEB_PROVIDER_CREDENTIAL_MISSING` while the stable tool schema remains registered. The provider calls Tavily's `POST /search`, requests a synthesized answer by default, maps result content and publication dates into the provider-neutral result, and rejects redirects before credentials can be forwarded to another endpoint.

The default mount does not enable `web_fetch` or a local fetch provider. `web_search` executes outside shell and filesystem permission presets; deployments that require network restrictions must add a `tools/pre-execute` policy or capability-specific network confinement.

## Alternatives considered

**Mount only `dsh-tool-web`.** Stable schemas without a registered provider would make every default call fail. A shipped default must supply its intended implementation.

**Freeze `process.env.TAVILY_API_KEY` at provider load.** The credentials service supports runtime storage and rotation; resolving per operation makes the next search observe the new value without restart.

**Keep Web tools in the Host bundle.** Tools belong to one agent session and are owned by shipped presets. The Host bundle owns only shared services and providers.

**Enable search and fetch together.** Default `web_fetch` would allow model-selected anonymous outbound HTTP(S) retrieval to arbitrary URLs. Deployments accepting broader retrieval can mount `dsh-web-fetch-http` and enable the tool through an overlay.

## Consequences

Shipped sessions expose the stable `web_search` model contract while Tavily supplies generated answer text, snippets, source URLs, titles, and available publication dates. Search credentials can rotate without remounting the provider, and redirect responses cannot forward the bearer token automatically. Full-page retrieval remains opt-in. Provider tests cover mapping, credential failures, cancellation, request fields, disposal, and redirect rejection; the browser scenario boots the shipped composition against a local Tavily-compatible endpoint and pins the durable tool result and card presentation.
