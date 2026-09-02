# @deepseek-ai/dsh-memory-compaction

English | [中文](README.zh.md)

The archival compaction backend for the [tag-indexed memory family](../README.md): a `MemoryCompactionEngine` that subclasses [`BasicCompactionEngine`](../../compaction/compaction-basic/README.md) and, on every compaction, (1) asks the model for retrieval tags, (2) writes an organized transcript copy of the shadowed span through `ctx.spillStore`, and (3) appends a `memory/archived` index record once the transaction commits. It registers `ctx.compaction`, replacing `compaction-basic` as the backend.

It reuses `compaction-basic`'s pressure, retention, and durable transaction machinery. Before the summarization call it projects the selected messages to remove the `memory:catalog` runtime-context section; unrelated sections in the same aggregate snapshot remain.

## What it owns

- **Tagging** — `summaryInstruction()` appends a directive asking the model to end its checkpoint with a `TAGS:` line. The engine parses that line into 3–7 lowercase tags, keeps a clean digest card (the `TAGS:` line never reaches the model), and falls back to a single `general` tag when the model emits none.
- **Organized copy** — the archive-visible span is written as a role-labelled transcript through `ctx.spillStore.saveText` (a required injection), under a tag-derived filename. The locator is recorded on the index entry.
- **Indexing** — a `memory/archived` record (owned by [`memory-core`](../memory-core/README.md)) is appended after `compactRegion`/`compactNow` commit, carrying the tags, digest, archive-visible seqs, and locator. Because indexing runs post-commit, a record never refers to an un-shadowed span. The generic compaction result still retains the complete positional replacement provenance.
- **Catalog exclusion** — the `memory:catalog` section is removed before summarization, hashing, spill output, and archive indexing. An aggregate runtime-context snapshot that also carries unrelated sections is re-rendered with those sections preserved, while its seq is omitted from the archive because the durable node contained catalog material.
- **Idempotence** — the entry id is `entryIdFor(shadowedMessages)`, a content hash. Re-archiving the same span (e.g. after it was recalled and folded back) reuses the id, so the catalog and organized copy never duplicate.

Both the automatic pressure/overflow paths and the manual `/compact` path archive.

## Config

`BasicCompactionConfig` unchanged — this backend adds no config key. `spillStore` is added to the required `inject` list.

## Model Experience

### Conversation history

#### What the model sees

The checkpoint the model sees is the digest card — the same `<compacted-summary>`-framed shape `compaction-basic` produces, with the parsed trailing `TAGS:` line removed. The card replaces the selected older range and is followed by the retained recent units. The card's digest names the tags the span was archived under, so the model knows what it can pull back with `recall_memory`.

#### Token effect

The digest card replaces an older range rather than appending, reducing future input history; it is strictly smaller than the span it shadows. The `TAGS:` line is stripped before the card lands, so it costs nothing after archival.

#### KV Cache effect

Replacing rather than append-only. Each checkpoint invalidates reuse from the first replaced history token; the unchanged request prefix before that range remains reusable — identical to `compaction-basic`.

### Auxiliary summarizer request

#### What the model sees

The summarization model receives the selected conversation with the `memory:catalog` section removed, followed by the base compaction instruction with one appended directive: end the checkpoint with a single `TAGS:` line of 3–7 lowercase retrieval tags. Other sections in the aggregate runtime-context snapshot remain. The conversation model never sees this private request; only the returned text (minus the parsed `TAGS:` line) is stored.

#### Token effect

Reuses the conversation prefix, so the auxiliary call's only novel input is the instruction plus tag directive. The tag directive adds a few tokens to that final user message.

#### KV Cache effect

The replayed prefix reuses the provider's warm cache exactly as in `compaction-basic`; the appended tag directive is the trailing novel input and does not alter the earlier prefix.

## Known Limitations and Deferred Work

- **No hierarchical roll-up.** Repeated compaction cycles merge the prior checkpoint (inherited from `compaction-basic`), but archived index entries and their digest cards are not yet rolled up into coarser entries, so their count grows with a very long session.
- **The organized copy is text-only.** `renderTranscript` keeps text blocks; images and other non-text content in the shadowed span are omitted from the on-disk copy. Recall reconstructs from the log, which is unaffected.
