# Agent Note: Tag-indexed memory over compaction

Status: implemented

English | [中文](2026-08-26-tag-indexed-memory.zh.md)

## Problem

Compaction keeps a long conversation under the context window by replacing an older span with a concise summary card. The shadowed events stay in the durable log, but they are unreachable to the model afterward — the only thing that survives into the window is the summary. For work that revisits an earlier topic (a file touched twenty turns ago, a decision whose rationale was compacted away), the model cannot get the detail back short of the user re-explaining it.

We wanted a memory the model can **retrieve on demand**: keep the top of context minimal, but let the model pull an archived span back by topic when it needs it, and let that pulled-in span leave again once it is done. Three properties were non-negotiable:

1. **Idempotent archival** — recalling a span and later re-compacting it must not create a second, near-duplicate archive; storage and the index must be bounded by the number of *distinct* spans, not by recall count.
2. **Deterministic recall** — a recalled span must reproduce exactly under session replay, with no dependency on external mutable state.
3. **Immutable entries, use-once expansion** — a recalled span is a temporary expansion; folding it back must not mutate the original archive.

## Decision

Four opt-in packages under `packages/memory/`, layered on the existing [compaction seam](2026-06-18-compaction-capability-seam.md). None ship in a default composition.

### `memory-core` — shared vocabulary (no policy)

Owns the `memory/archived` log-only `SessionEventMap` member, the `memoryIndex` session projection that folds those records into a tag catalog, and `entryIdFor(messages)`. The entry id is a **content hash** of the shadowed messages' roles and content (message ids excluded), which is what makes archival idempotent: a span recalled and re-archived hashes to the same id, so the index (last-wins by id) and the on-disk copy never duplicate.

### `memory-compaction` — archival backend

`MemoryCompactionEngine extends BasicCompactionEngine`, reusing its replay/price/transaction machinery unchanged. It customizes exactly two seams:

- **Tagging** via a new `protected summaryInstruction()` hook added to `BasicCompactionEngine` (see below): the subclass appends a directive asking the model to end its checkpoint with a `TAGS:` line, then parses that line off, keeping a clean digest card.
- **Post-commit indexing**: the `memory/archived` record is appended *after* `super.compactRegion()`/`super.compactNow()` commit, because `summarize()` does not receive the shadowed seqs — only the committed `CompactionResult` carries them. Appending post-commit also guarantees a record never refers to an un-shadowed span, and orphan risk is nil.

The shadowed span is additionally written verbatim through `ctx.spillStore` as an organized, tag-named transcript — the "filesystem copy" — but this copy is **not** on the recall path.

### `tool-recall` — model-facing retrieval

`recall_memory(tags)` reads `memoryIndex`, matches by tag intersection (case-insensitive), and reconstructs each span **from the durable log at its `shadowedSeqs`** via `session.deriveEventMessage` — not from the spill copy. This is what delivers deterministic recall: the reconstructed content enters context as a normal, logged `tool/result`, and the seqs it reads never leave the log, so replay reproduces it exactly. The spill copy remains a human-inspectable / model-greppable artifact only.

### `memory-ttl-pruner` — use-once fold-back

A standalone service driven from `agent/pre-step` (independent of compaction pressure, modeled on `compaction-tool-result-pruner`). It identifies `recall_memory` results by pairing them to their `recall_memory` `tool/call`, ages them by counting `step/start` events after the result, and once past `retainSteps` folds each back with a `compaction/prune` shadow-price event plus a `tool/result` `replace` to a one-line stub. The `memory/archived` entry is untouched — recall is repeatable.

### Enabling change to `compaction-basic`

To make `summarize()` genuinely overridable by a subclass that needs a different checkpoint shape, `compaction-basic` now: exports `SummarizationInput`/`SummaryResult`; threads an `instruction` parameter (default `COMPACTION_INSTRUCTION`) through `summarizeWithLlm`; and exposes a `protected summaryInstruction()` hook that the default `summarize()` calls. Behavior-preserving — all 122 existing `compaction-basic` tests pass unchanged.

## Alternatives considered

- **A dedicated `memory/archived` event emitted inside `summarize()`.** Rejected: `summarize()` lacks the shadowed seqs, and appending mid-transaction risks an orphan record if the transaction later fails. Post-commit indexing from the `compactRegion`/`compactNow` overrides is orphan-free and has the seqs.
- **Recall reads the spill file.** Rejected as the source of truth: it makes recall depend on external mutable filesystem state and weakens replay. The log already holds the shadowed events at recorded seqs, so recall reconstructs from there; the spill file is kept only as the organized on-disk artifact the user asked for.
- **Encoding tags/locator into the `compaction/summary` event.** Not possible — that event's shape is fixed in the seam package — and parsing them out of the model-facing card is fragile. A dedicated `memory/archived` record in `memory-core` is the clean home.
- **A system-prompt tag catalog section.** Added by the later [bounded memory catalog](2026-09-02-bounded-memory-catalog.md), which supplies agent-scoped session access and prevents the catalog from entering archived content.

## Consequences

- **Top stays bounded regardless of session length**: recent tail (`retainTokens`) + small digest cards + the recall tool, with detail on disk/in-log and pulled back only on demand and folded out after `retainSteps`.
- **Deferred**: hierarchical roll-up of old digest cards/index entries; automatic tag-matched recall (v1 is model-driven only); token/relevance-aware TTL; non-text blocks in the organized copy and reconstructed transcript.
- **New model-visible surface** (`recall_memory` tool, `memory/archived` event) is covered by each package's keyless real-composition tests; the SessionEventMap addition is reflected in the persistence catalog.
