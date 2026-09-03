# Agent Note: Session directives and history-capacity compaction

Status: implemented

English | [中文](2026-09-03-session-directives-and-history-capacity-compaction.zh.md)

## Problem

A user's standing instructions are active policy, not episodic facts. Recovering them only through tagged memory makes compliance depend on recall, while retaining the original request forever makes policy lifetime depend on conversation compaction. Automatic persistence also needs a narrow authority rule: old turns, recalled text, tool output, Web content, and subagent output can contain imperative wording without authorizing a durable preference.

Compaction has a related accounting problem. A model context window must accommodate the request header, current runtime context, output headroom, and a safety reserve as well as compactable conversation history. Applying threshold and retention ratios to the whole model window counts fixed request material as if it were reclaimable history and triggers at the wrong point. Provider usage totals cannot repair that partition because their buckets are opaque and may not correspond to the harness's independently estimated message sections.

## Decision

### Directives are session-owned durable current state

`@deepseek-ai/dsh-session-directives` owns a session-scoped directive list. Each entry has a stable `key`, model-facing `value`, producer `source`, and literal `scope: 'session'`. Setting an existing key replaces its value without growing the list. Every successful set, remove, or clear appends one versioned `directive/change` event containing the complete post-change list; replay is last-write-wins and the `sessionDirectives` projection exposes the same state to clients.

The service renders the active list as the named `session:directives` runtime-context section. The aggregate runtime-context `user/message` snapshot remains the model-visible durable representation, so a directive survives replacement of the user message that established it and remains reconstructable without moving policy into `EpochHeader.system`.

The default limits are 12 entries, 256 estimated tokens for the complete rendered section including its wrapper and attribution, and 200 Unicode code points per value. An oversized mutation fails before appending an event. The service does not truncate, summarize, evict, or silently omit directives.

### Mutation authority comes from the current direct-human turn

`@deepseek-ai/dsh-session-directive-consumers` provides explicit `/directive` operations and model-facing list, set, and remove tools. A model mutation is accepted only for the exact live root agent in its active driver when the open turn contains a current `user/message` whose source kind is `user`. Recalled memory, injected plugin context, tool results, Web content, subagent output, prior turns, and model inference do not establish that authority.

Automatic recognition is deliberately narrow. It inspects only the current root direct-human message and recognizes the supported concise-response preference. Explicit future wording persists it; explicit one-response wording does not. Ambiguous preference wording uses the user-question service for confirmation and otherwise emits a notice asking the model to confirm instead of mutating state. V1 does not promote directives to workspace or global scope.

The Web client projects `sessionDirectives` into a session-scoped `conversation.view` entry with order 20, beside Chat at 0 and Trajectory at 10. Add, edit, delete, and clear actions use the same `/directive` command path as other human controls rather than a second mutation API.

### Current-state context is not episodic memory

Memory archival treats `memory:catalog` and `session:directives` as current-state runtime sections. It removes those sections before summary input, archive identity, spill transcript, recall reconstruction, archive token accounting, and `memory/archived.shadowedSeqs`; unrelated episodic sections in the same aggregate snapshot remain. Generic compaction replacement provenance still records its complete contiguous source range.

This extends the isolation rule in the [bounded memory catalog decision](../feature/2026-09-02-bounded-memory-catalog.md): the catalog advertises recallable episodic entries, while directives actively constrain each relevant request. Neither current-state section recursively becomes episodic memory.

### Compaction budgets only reclaimable history

`agent/pre-dispatch` exposes the final canonical header and complete model-visible messages after route and request assembly but before `llm.stream`. A listener that changes durable request inputs returns `{ kind: 'retry' }`, causing the loop to rebuild rather than dispatch the stale request.

Automatic proactive compaction measures at this extension point, including current boundary messages. It partitions the request into compactable history and fixed request material. Runtime-context snapshot nodes contribute to fixed material, not history. For the exact routed model:

```text
historyCapacity = contextWindow - fixedRequestTokens - safetyReserveTokens
thresholdTokens = floor(historyCapacity × thresholdRatio)
retainTokens = floor(historyCapacity × retainRatio)
```

`fixedRequestTokens` includes the canonical header, non-history message material, and the request's output headroom. The runtime context is excluded from `historyTokens`, so it is not counted again as both fixed overhead and history. `safetyReserveTokens` defaults to 0 and participates in top-level and exact provider/model policies. The existing Web memory policy retains `thresholdRatio: 0.45`, `retainRatio: 0.12`, `maxTokens: 8192`, and `compactionRetries: 1`; `maxTokens` remains the summarizer output cap rather than a history budget.

The token meter may use provider usage as an anchor for aggregate request pressure, but compaction never derives fixed overhead by subtracting independently estimated surface tokens from an opaque provider total. It separately estimates the final canonical header and message partitions. Provider-confirmed `CONTEXT_WINDOW_EXCEEDED` recovery remains capacity-independent, bypasses proactive ratios, and retries only after durable surface progress.

## Verification

Directive service and consumer tests pin complete-state replay, stable-key replacement, active-limit validation, failed-write atomicity, direct-human persistence authority, wording polarity and duration classification, command and tool behavior, runtime rendering, projection lifecycle, and real Loader composition. Client tests pin the session projection, command mutations, immutable edit keys, peer view ordering, and disposal. Memory tests pin current-state exclusion while retaining unrelated aggregate sections and their source sequences.

Compaction coverage pins target-policy validation, exact history-capacity scaling after fixed request and safety-reserve subtraction, final pre-dispatch timing, durable retry-driven request reconstruction, runtime-context partitioning, and provider overflow recovery.

## Alternatives considered

**Treat directives as episodic memory.** Rejected because recall is selective and model-initiated, while an active instruction must be supplied on every relevant request until explicitly changed or removed.

**Infer persistence from any preference-like wording or any context source.** Rejected because ambiguity and untrusted quoted instructions would silently acquire durable authority. Explicit future wording or a direct confirmation is required, and only the current top-level human turn may authorize mutation.

**Add workspace or global scopes in V1.** Rejected because their ownership, inheritance, authorization, and deletion semantics differ from a session log. The durable format fixes V1 scope to `session`.

**Truncate, summarize, or evict oversized directives.** Rejected because silent rewriting changes policy semantics. The complete proposed state either fits or fails visibly.

**Scale compaction ratios over the full context window.** Rejected because header, runtime policy, output headroom, and reserves are not reclaimable conversation history.

**Derive fixed overhead from provider total minus estimated surface.** Rejected because provider usage buckets are opaque and subtraction mixes incompatible measurements.

**Run exact proactive pressure at `agent/pre-step`.** Rejected because routing, header assembly, runtime-context reconciliation, tools, and final boundary messages are not all fixed there. `agent/pre-dispatch` observes the request that would actually be sent.

**Place directive controls in settings or a separate application column.** Rejected because directives belong to one conversation and use its projection and command lifecycle. A peer `conversation.view` keeps their scope visible beside Chat and Trajectory.

## Consequences

Standing instructions remain active after their originating text is compacted, are bounded by stable keys and complete-output limits, and can be inspected and removed through the same session in both model and Web paths. The narrow authority rule gives up broad natural-language preference extraction and supports only conservative recognizers unless explicit operations are used.

Compaction thresholds and retained-tail budgets track the portion of each routed model window that history can actually occupy. Larger runtime policy or output headroom reduces history capacity immediately at the final request boundary without double-counting those tokens. The extra pre-dispatch extension point and retry may rebuild a request after compaction, but it prevents dispatch against stale accounting.

This note partially supersedes the proactive denominator and timing in [routed model context and compaction policy](2026-07-20-routed-model-context-and-compaction-policy.md) and [after-call compaction pressure and context-overflow recovery](2026-07-10-after-call-compaction-pressure-and-overflow-recovery.md). Adapter-owned capacity, exact-target policy, the model-agnostic token meter, and provider-confirmed overflow recovery remain authoritative there.
