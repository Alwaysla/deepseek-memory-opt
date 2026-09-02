# memory/ — tag-indexed memory family

English | [中文](README.zh.md)

A long-term memory family layered on the [compaction](../compaction/README.md) seam: shared vocabulary, an archival compaction backend, a bounded model-facing catalog, a recall tool, and a TTL pruner. These are **product** packages; the Web app composes them together.

| Package | Role | ctx key |
|---|---|---|
| [`memory-core/`](memory-core/README.md) | `memory/archived` event, `memoryIndex` projection, content-hash entry ids | registers `memoryIndex` on `ctx.sessionProjections` |
| [`memory-compaction/`](memory-compaction/README.md) | Compaction backend that tags, spills, and indexes each archived span | registers `ctx.compaction` |
| [`memory-catalog/`](memory-catalog/README.md) | Bounded recent `tags + digest` runtime-context section | registers `memory:catalog` on `ctx.systemPrompt` |
| [`tool-recall/`](tool-recall/README.md) | `recall_memory(tags)` tool over the durable log | registers on `ctx.tools` |
| [`memory-ttl-pruner/`](memory-ttl-pruner/README.md) | Folds aged recall results back to a stub | `ctx.memoryTtlPruner` |

## How they compose

`memory-compaction` replaces `compaction-basic` as the `ctx.compaction` backend. On each compaction it asks the model for retrieval tags, writes an organized transcript copy through `ctx.spillStore`, and appends a `memory/archived` index record (owned by `memory-core`). `memory-core` folds those records into `memoryIndex`; `memory-catalog` projects a bounded recent `tags + digest` view into every relevant model request, and `recall_memory` reconstructs a selected span from the durable log. `memory-ttl-pruner` later folds recalled content back out without touching the archive entry. Catalog text is excluded from memory summaries, archive identity, archive seqs, spill copies, and recall output.

The design rationale — idempotent archival, deterministic recall, use-once-then-fold — is in the [tag-indexed memory Agent Note](../../.agents/notes/implemented/feature/2026-08-26-tag-indexed-memory.md).
