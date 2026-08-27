# memory/ — tag-indexed memory family

English | [中文](README.zh.md)

A long-term memory family layered on the [compaction](../compaction/README.md) seam: a shared vocabulary, an archival compaction backend, a model-facing recall tool, and a TTL pruner. All **product** packages, opt-in — none ship in a default composition.

| Package | Role | ctx key |
|---|---|---|
| [`memory-core/`](memory-core/README.md) | `memory/archived` event, `memoryIndex` projection, content-hash entry ids | registers `memoryIndex` on `ctx.sessionProjections` |
| [`memory-compaction/`](memory-compaction/README.md) | Compaction backend that tags, spills, and indexes each archived span | registers `ctx.compaction` |
| [`tool-recall/`](tool-recall/README.md) | `recall_memory(tags)` tool over the durable log | registers on `ctx.tools` |
| [`memory-ttl-pruner/`](memory-ttl-pruner/README.md) | Folds aged recall results back to a stub | `ctx.memoryTtlPruner` |

## How they compose

`memory-compaction` replaces `compaction-basic` as the `ctx.compaction` backend. On each compaction it asks the model for retrieval tags, writes an organized transcript copy through `ctx.spillStore`, and appends a `memory/archived` index record (owned by `memory-core`). `memory-core`'s `memoryIndex` projection folds those records into a tag catalog. `recall_memory` reads that catalog and reconstructs a matched span from the durable log at its shadowed seqs. `memory-ttl-pruner` folds a recalled span back out of context once it has aged, without touching the immutable archive entry.

The design rationale — idempotent archival, deterministic recall, use-once-then-fold — is in the [tag-indexed memory Agent Note](../../.agents/notes/implemented/feature/2026-08-26-tag-indexed-memory.md).
