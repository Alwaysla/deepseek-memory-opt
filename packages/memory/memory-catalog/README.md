# @deepseek-ai/dsh-memory-catalog

English | [中文](README.zh.md)

Publishes a bounded, newest-first catalog of archived memories as the named `memory:catalog` runtime-context section. The section is derived on each prompt assembly from the current agent session's `memoryIndex`; it contains only retrieval tags and digest text.

## Config

- `maxEntries` (default `20`) limits recent entries before rendering.
- `maxTokens` (default `1200`) bounds the complete rendered section using the harness's conservative four-characters-per-token estimate.
- `digestMaxChars` (default `160`) truncates each digest by Unicode code point.

## Model Experience

### Runtime memory catalog

#### What the model sees

When memory exists, the current runtime-context snapshot includes a compact list such as `tags: sqlite, migration — database migration work` plus guidance to call `recall_memory`. Empty indexes contribute no text. Full archived conversation text is never injected automatically.

#### Token effect

The complete section is bounded by both entry count and estimated tokens. Newer `summarySeq` entries win; `entryId` breaks ties deterministically.

#### KV Cache effect

The agent loop logs a new aggregate runtime-context snapshot only when its rendered value changes. Memory compaction removes `memory:catalog` from summarization, archive identity, archive seqs, spill output, and recalled content while preserving unrelated runtime-context sections.

## Known Limitations and Deferred Work

- The token bound uses the same conservative text estimate as prompt planning rather than provider-specific tokenization.
- Matching remains tag-intersection based; the catalog does not rank entries semantically.
