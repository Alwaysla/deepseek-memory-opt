# @deepseek-ai/dsh-session-directive-consumers

English | [中文](README.zh.md)

Human and model controls for [`ctx.sessionDirectives`](../session-directives/README.md), plus a deliberately narrow recognizer for concise-response preferences. All mutations call the domain service; this package neither appends directive events nor renders directive context itself.

## Command

`/directive` and `/directive list` return the active list. `/directive set <key> <JSON-string value>` sets one session-scoped directive, `/directive delete <key>` removes one, and `/directive clear` removes all. Keys use lowercase letters, digits, dots, underscores, and hyphens. Values must be JSON strings so spaces and escapes have one unambiguous grammar. Images are rejected.

## Tools and authority

`list_directives()` reads the calling session. `set_directive(key, value)` and `remove_directive(key)` mutate it. Mutation requires the exact live, running calling agent inside its active driver and a host-attested direct-human message in the current open turn of a runtime root. Subagents, plugin messages, stale agents, closed turns, and autonomous turns cannot grant authority.

## Automatic recognition

The pre-step recognizer supports one stable inferred key, `response.concise`. It persists only wording that combines a concise-response preference with explicit future persistence, such as “from now on keep responses concise” or “以后回答都简洁一些”. `这次`, `本次`, `for this response`, and equivalent one-turn wording never persist. Ambiguous preference wording asks for confirmation through `ctx.userQuestions` when that optional service is available. Without it, the recognizer adds a non-mutating notice asking the model to confirm; unrelated or merely descriptive wording produces no result.

Recognition examines exactly one current `{ kind: 'user' }` message on a runtime-root pre-step. It ignores plugin, model, tool, subagent, and mixed/multiple direct-user message batches.

## Composition

Mount the root entry on the Host for `/directive` and direct-human recognition. Mount the tools subpath only in presets that should expose model controls:

```yaml
# Host
- name: '@deepseek-ai/dsh-session-directive-consumers'

# Agent preset
- name: '@deepseek-ai/dsh-session-directive-consumers/tools'
```

Both entries consume the Host-owned `sessionDirectives` service. The root also consumes `agents` and `commands`; `userQuestions` is optional and enables the confirmation dialog. The tools entry consumes the scoped tool registry and does not publish a service.

## Model Experience

### Directive controls and recognition notice

#### What the model sees

The generated `list_directives`, `set_directive`, and `remove_directive` schemas expose explicit session-only operations. Mutating tools require matching persistent or removal wording in the current top-level direct-human message; other request or tool content cannot authorize a change. Successful results are compact JSON. When ambiguous concise-response wording cannot use a confirmation channel, the current request also receives a notice that no preference was persisted and asks the model to confirm before mutation.

#### Token effect

Tool schemas add a fixed input cost while in scope. Lists and mutations add compact result tokens. The fallback recognition notice is conditional; explicit persistent recognition itself adds no separate message because the domain's runtime-context contribution represents accepted state.

#### KV Cache effect

Schemas are prefix-stable while visibility and definitions remain unchanged. Directive mutations change the domain-owned runtime context on later requests. A fallback notice appends only to the current request.

## Known Limitations and Deferred Work

- **One inferred preference** — automatic recognition intentionally supports only concise responses; every other directive requires an explicit command or tool call.
- **Session scope only** — workspace directives, undo, and feedback are not V1 operations.
- **Confirmation depends on a provider** — without `ctx.userQuestions`, ambiguous wording yields a non-mutating model notice rather than blocking or guessing.
