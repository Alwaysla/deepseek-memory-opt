# @deepseek-ai/dsh-tool-recall

English | [中文](README.zh.md)

The model-facing `recall_memory` tool for the [tag-indexed memory family](../README.md). Given retrieval tags, it returns the conversation spans that were archived under those tags during compaction, reconstructed from the durable session log. Registering this plugin adds the tool on `ctx.tools`.

## Behavior

- **Input** — `recall_memory({ tags: string[] })`. A checkpoint card lists the tags it archived; the model passes one or more of them.
- **Match** — reads the `memoryIndex` projection through `ctx.sessionProjections` (optional: absent seam ⇒ no memories) and selects entries whose tags intersect the request, case-insensitively.
- **Reconstruct** — for each matched entry, rebuilds a role-labelled transcript from the durable log at the entry's `shadowedSeqs` (via `session.deriveEventMessage`), **not** from the on-disk copy. Recall therefore reproduces exactly under replay: the tool result itself is a logged `tool/result`, and the seqs it reads never leave the log.
- **Return** — a canonical `{ memories: [{ entryId, tags, digest, content }] }` value, rendered to the model as `<recalled-memory>` blocks, or a short "no archived memory matched" notice.

A call with no owning agent session is rejected — the tool reads per-session state and a non-agent caller has none.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`recall_memory` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-recall).

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Recall result

#### What the model sees

A `recall_memory` call returns each matched archived span reconstructed from the durable log, wrapped in `<recalled-memory tags="…">` … `</recalled-memory>` text blocks, or the notice `No archived memory matched those tags.` A call with no owning agent session returns `Error: recall_memory requires an agent session`. The reconstructed transcript is text-only.

#### Token effect

A recalled span re-enters context at roughly the size of the original span's text and remains until the TTL pruner folds it back or compaction shadows it again.

#### KV Cache effect

Append-only: the result follows the reusable request prefix and does not invalidate existing entries. A later fold-back by [`memory-ttl-pruner`](../memory-ttl-pruner/README.md) is a surface replace that invalidates reuse from the folded node onward.

## Known Limitations and Deferred Work

- **Model-driven recall only.** The model must choose to call `recall_memory` with tags it sees on a checkpoint card; there is no automatic tag-matched recall yet (a deferred family goal).
- **Text-only reconstruction.** Non-text blocks in a shadowed span are omitted from the reconstructed transcript.
