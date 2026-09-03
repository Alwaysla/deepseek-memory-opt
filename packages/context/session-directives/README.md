# @deepseek-ai/dsh-session-directives

English | [中文](README.zh.md)

Host-only durable same-session directives. `ctx.sessionDirectives` lists, sets, removes, and clears directives by stable key; every accepted mutation appends a complete `directive/change` state, and replay is last-write-wins.

## Config

```yaml
- id: session-directives
  name: '@deepseek-ai/dsh-session-directives'
  config:
    maxEntries: 12
    maxTokens: 256
    valueMaxChars: 200
```

All limits are positive safe integers. `maxEntries` bounds active keys, `valueMaxChars` counts Unicode code points in one value, and `maxTokens` bounds the complete rendered contribution using the package's fixed four-characters-per-token estimate. A write that would exceed any limit throws `SessionDirectivesError` and appends no event. Replayed state that exceeds the active deployment limits is rejected before listing, projection, or model rendering.

## Semantics

Each directive contains `key`, `value`, `source`, and the V1 literal scope `session`. String values are trimmed and must remain non-empty. Setting an existing key replaces it in place; setting a new key appends it. Removing an absent key and clearing an empty state are no-ops. Service reads return detached values reconstructed from the session log.

The optional `sessionDirectives` SessionProjection host/wire key contains the complete active list. The `./invariant` companion rejects malformed durable payloads before publication and validates existing sessions when mounted.

## Model Experience

### Active session directives

#### What the model sees

The `session:directives` dynamic context renders only when a request has an agent with active directives. The system-prompt service places this contribution inside its durable aggregate runtime-context snapshot.

##### Rendered section

```markdown
Session directives:
- [<scope>] <key> (source: <source>): <value>
```

#### Token effect

The complete contribution is bounded by `maxTokens`; rejected writes do not change model context. Replacements change the next runtime-context snapshot without accumulating directive entries.

#### KV Cache effect

An unchanged directive state reuses the retained runtime-context snapshot. Any accepted state change causes the next request to append a replacement snapshot after the reusable prefix.

## Known Limitations and Deferred Work

- The package intentionally provides no command, model tool, automatic recognizer, Web UI, compaction policy, or bundle wiring.
- Token limits use a deterministic character-density estimate rather than provider tokenization.
