# @deepseek-ai/dsh-memory-core

English | [中文](README.zh.md)

Shared vocabulary for the [tag-indexed memory family](../README.md): the `memory/archived` session event, the `memoryIndex` projection, and the content-hash `entryIdFor` identity. This package owns no policy — it is the declaration home the archival backend, the recall tool, and the TTL pruner all build on.

## What it provides

- **`memory/archived` event** — a log-only `SessionEventMap` member (no `surfaceOp`) carrying one archived span's `entryId`, `tags`, `digest`, `shadowedSeqs`, `shadowedTokenCount`, and `summarySeq`, plus the organized copy's `locator`. Appended by `memory-compaction` after a compaction transaction commits, so every record refers to a span already shadowed on the surface. Purely informational: the span's raw events remain in the log at `shadowedSeqs`, so losing the record loses only the index, never reconstructability.
- **`memoryIndex` projection** — folds every `memory/archived` record into `{ entries: Record<entryId, MemoryEntry> }`, last-wins by id. Registered on `ctx.sessionProjections` when that seam is composed; a headless assembly without it is unaffected. Client-visible, so a UI can read the whole catalog.
- **`entryIdFor(messages)` / `EntryId`** — a span's content-hash identity. Hashes message roles and content only (message ids are excluded), so a span recalled and re-archived hashes equal to its original and archival stays idempotent.
- **`RECALL_TOOL_NAME`** — the recall tool's model-facing name, shared with the tool that registers it and the pruner that recognizes its results.

## Model Experience

None, as this package only declares the log-only `memory/archived` event and the `memoryIndex` projection; the recall tool and the archival compaction backend own every model-facing effect.

#### KV Cache effect

No direct effect. This package assembles no provider request; a sibling that renders an archived span into a request owns the resulting prefix change.

## Known Limitations and Deferred Work

- **The `memoryIndex` value carries every archived entry.** Acceptable at session scale, but a very long session accumulates entries; a future revision may page or roll up old entries (see the family's hierarchical roll-up deferral).
