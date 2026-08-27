# @deepseek-ai/dsh-memory-ttl-pruner

English | [中文](README.zh.md)

The recalled-memory TTL pruner for the [tag-indexed memory family](../README.md). Once a `recall_memory` result has been in the model window for more than a configured number of steps, this service folds it back to a short stub, so temporarily recalled context does not linger and re-inflate the window. It registers `ctx.memoryTtlPruner` and drives itself from `agent/pre-step`, independent of compaction pressure.

## Behavior

On each pre-step, `pruneSession` scans the current surface for `tool/result` nodes whose call id belongs to a `recall_memory` `tool/call`. A result's age is the number of `step/start` events after it; once that exceeds `retainSteps`, the pruner:

1. appends a shadow-price `compaction/prune` event (priced through `ctx.tokenMeter`), then
2. appends a `tool/result` replacement synchronously after it, whose surface `replace` swaps the recalled span for a one-line stub inviting the model to `recall_memory` again.

The original `memory/archived` entry and its organized copy are untouched — recall is repeatable; folding only reclaims the window. Non-recall tool results are never folded.

## Config

| Key | Default | Meaning |
|---|---|---|
| `retainSteps` | `2` | Steps a `recall_memory` result stays verbatim before it is folded back. `0` folds it before the very next step; larger values keep it available across more steps. |

## Model Experience

### Folded recall result

#### What the model sees

Once a `recall_memory` result has aged past `retainSteps`, the model sees a one-line stub — `[Recalled memory folded back to free context. Call recall_memory again with the same tags to re-expand it.]` — in place of the earlier recalled span. Until then the recalled span is unchanged. The model can re-expand it by calling `recall_memory` with the same tags.

#### Token effect

Folding reclaims the recalled span's tokens, replacing them with the fixed-size stub. It never adds tokens: the stub is strictly smaller than the span it replaces.

#### KV Cache effect

The fold is a surface `replace`, so it invalidates reuse from the folded node onward — the same KV invalidation any compaction replacement causes. An already-folded stub is not folded again, so a folded result stops contributing further prefix churn.

## Known Limitations and Deferred Work

- **Age is counted in steps, not tokens or wall-clock.** `retainSteps` is a coarse window; a token- or relevance-aware policy is deferred.
- **Fold is unconditional once aged.** The pruner does not check whether the recalled span is still being referenced before folding; the model must re-recall if it still needs it.
