# Agent Note: Bounded memory catalog

Status: implemented

English | [中文](2026-09-02-bounded-memory-catalog.zh.md)

## Problem

Tag-indexed memory could reconstruct an archived span only after the model knew which tags existed. Individual checkpoint cards were not a dependable catalog because later compaction can replace them, while injecting full archived text on every request would defeat compaction. A catalog derived from durable memory also risks archiving itself: repeated catalog text could enter summaries, content identities, spill files, and later recall results.

## Decision

`@deepseek-ai/dsh-memory-catalog` registers one named `memory:catalog` dynamic context on `ctx.systemPrompt`. Each assembly reads the exact agent session supplied in `AssembleContext`, folds its `memoryIndex`, sorts entries newest-first by `summarySeq` with `entryId` as a deterministic tie-breaker, and renders only bounded tags and digest text. Empty indexes contribute nothing. The agent loop materializes the complete dynamic context as its existing logged aggregate snapshot, so the catalog is visible on each relevant request without creating another durable event type.

The catalog has explicit `maxEntries`, `maxTokens`, and `digestMaxChars` deployment limits. Full archived conversation content remains opt-in through `recall_memory(tags)`.

Memory archival projects aggregate runtime-context snapshots by their named sections. It removes `memory:catalog`, preserves and re-renders unrelated sections, and uses that projected view for the summarizer input, `entryIdFor`, spill transcript, and recall reconstruction. A durable snapshot node that contained catalog material is omitted from `memory/archived.shadowedSeqs`; generic compaction provenance still keeps the complete contiguous replacement range required by Session surface replay.

`Agent.preStep()` reconciles runtime context once after the pre-step waterfall. If automatic compaction shadows the retained aggregate snapshot during that waterfall, the same model request receives a replacement snapshot instead of waiting for the next step.

## Alternatives considered

**Use checkpoint-card tags as discovery.** Rejected because checkpoint cards are replaceable and therefore cannot guarantee a current catalog.

**Inject full archived spans automatically.** Rejected because it removes the token and attention benefits of compaction and makes retrieval non-selective.

**Publish a separate catalog message from a pre-step listener.** Rejected because the system-prompt registry already owns dynamic, logged runtime context and supplies exact per-agent assembly state. A separate state machine would duplicate replay, update, and disposal behavior.

**Remove catalog seqs from generic compaction provenance.** Rejected because surface replacement requires a complete contiguous source range. Memory archive seqs represent recallable content; generic replacement metadata represents positional history and remains complete.

## Consequences

The model always receives a bounded recent tag inventory and requests full details only through `recall_memory`. Catalog text cannot recursively accumulate in memories, while unrelated runtime policy remains available to the summarizer and archive. The catalog adds a small bounded prompt cost and uses a conservative text estimate rather than provider-specific tokenization. Older entries outside the configured window remain recallable when their tags are otherwise known.
