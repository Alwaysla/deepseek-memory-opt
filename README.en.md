# DeepSeek Harness with Memory Optimization

English | [中文](README.md)

A DeepSeek Harness fork for long-running tasks. It adds **tag-indexed memory, on-demand recall, durable session directives, and history-capacity-based compaction** so models can recover more information without keeping the full conversation in every request.

> This project extends [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) under the [MIT License](LICENSE). It remains a developer preview; configuration and persisted formats may change incompatibly.

## Highlights

- 🧠 **Tag-indexed memory**: Generate tags and digests during compaction and record original event locations in the durable session log.
- 🔎 **On-demand recall**: Show the model a bounded `tags + digest` catalog and call `recall_memory(tags)` only when old details are needed.
- ♻️ **Automatic fold-back**: Keep recalled text for a limited number of steps, then fold it again before it expands the active context.
- 📌 **Durable session directives**: Store requests such as “keep future responses concise” as session state instead of relying on model recall.
- 🧭 **Directive controls in Web**: Manage directives from a peer view beside Chat and Trajectory, with add, edit, delete, and clear actions.
- 📐 **History-capacity compaction**: Subtract the header, runtime context, output headroom, and safety reserve before scaling compaction budgets.
- 🧩 **Everything is a plugin**: Memory, recall, directives, and Web controls are composed through [Cordis](https://github.com/cordiverse/cordis) and can be replaced per profile.

## How it works

```text
Older conversation history
      │
      ▼
memory-compaction ── generates a digest, tags, and archive index
      │
      ├── active context keeps only the digest
      └── original events remain in the Session log
                         │
                         ▼
memory-catalog ── supplies bounded tags + digests to relevant requests
                         │
                 model needs old details
                         │
                         ▼
recall_memory(tags) ── reconstructs the original span from the Session log
                         │
                         ▼
memory-ttl-pruner ── folds the recalled text again after several steps
```

Session directives use a separate path. Each accepted change appends a durable `directive/change` event, and active directives enter relevant model requests through the `session:directives` runtime context. The memory catalog and directives represent current state and are excluded from episodic archives.

<a id="run"></a>

## Quick start

### Requirements

- Node.js `^22.19.0` or `>=24.0.0`
- pnpm `11.7.0`
- Model credentials such as `DEEPSEEK_API_KEY`

<a id="run-from-source"></a>

### Run this fork from source

```sh
git clone https://github.com/Alwaysla/deepseek-memory-opt.git deepseek-harness
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

Open `http://127.0.0.1:3080`. `pnpm run build` prepares repository artifacts, and `pnpm dsh web` starts the Web UI from those artifacts without rebuilding them.

> `npx @deepseek-ai/dsh web` installs and runs the official npm package; it does not include this fork's memory and directive extensions.

## Use session directives

### Web UI

Open a session and select the Directives view beside Chat and Trajectory. You can add, edit, delete, or clear directives for that session. An undeleted directive survives page refreshes and compaction of its original user message.

### Command

```text
/directive list
/directive set <key> <JSON-string value>
/directive delete <key>
/directive clear
```

Example:

```text
/directive set response.concise "Keep responses concise"
```

The standard, Code, and Cordis agent presets also expose `list_directives`, `set_directive`, and `remove_directive`. Mutation tools require matching persistent or removal intent in the current top-level human message; one-turn requests, older messages, Web content, recalled text, and tool output cannot authorize a durable change.

## Recall archived memory

A compact tag-and-digest catalog enters relevant requests automatically, but archived transcripts do not. When the current task depends on an older detail, the model can call:

```text
recall_memory({ tags: ["session-directives", "compaction"] })
```

Recall reconstructs content from the durable Session log. External transcripts are inspection copies and do not determine the result.

## Default Web configuration

```yaml
- insert:
    - id: memory-compaction
      name: '@deepseek-ai/dsh-memory-compaction'
      config:
        thresholdRatio: 0.45
        retainRatio: 0.12
        maxTokens: 8192
        compactionRetries: 1

    - id: memory-catalog
      name: '@deepseek-ai/dsh-memory-catalog'
      config:
        maxEntries: 20
        maxTokens: 1200
        digestMaxChars: 160

    - id: memory-ttl-pruner
      name: '@deepseek-ai/dsh-memory-ttl-pruner'
      config:
        retainSteps: 2
```

Configuration meanings:

- `thresholdRatio`: proactively compact when history reaches 45% of its available capacity.
- `retainRatio`: target about 12% of history capacity after compaction.
- `maxTokens` on memory-compaction: maximum summarizer output, not the trigger threshold or context-window size.
- `maxEntries`, `maxTokens`, and `digestMaxChars` on memory-catalog: bound the catalog supplied to the model.
- `retainSteps`: number of steps that complete recalled text remains in active context.

See [`packages/bundle/web-app/cordis.patch.yml`](packages/bundle/web-app/cordis.patch.yml) for the assembled configuration.

## Verify the features

1. Add a directive in the Directives view and refresh the page; it should remain present.
2. Continue the conversation and confirm that the directive enters runtime context and affects the response.
3. Delete the directive and refresh; it should neither return nor constrain later responses.
4. Continue a long conversation until compaction creates memory-catalog tags and digests.
5. Ask for an early detail and confirm that the model uses `recall_memory` to retrieve the archived span.

## Documentation

- [Current workspace memory, directive, and compaction design](Markdown/Deepseek-harness-memory-opt.md)
- [Tag-indexed memory Agent Note](.agents/notes/implemented/feature/2026-08-26-tag-indexed-memory.md)
- [Bounded memory catalog Agent Note](.agents/notes/implemented/feature/2026-09-02-bounded-memory-catalog.md)
- [Session directives and history-capacity compaction Agent Note](.agents/notes/implemented/architecture/2026-09-03-session-directives-and-history-capacity-compaction.md)
- [DeepSeek Harness architecture](docs/architecture.md)
- [Web UI guide](docs/user/guide/index.md)

## Development

```sh
pnpm run typecheck
pnpm run test
pnpm run test:gui
pnpm run doc-sync
```

Before changing code, read the [development guide](docs/development.md), [contribution guide](CONTRIBUTING.md), and agent instructions in [AGENTS.md](AGENTS.md).

## Community and support

- Fork issues and suggestions: [Alwaysla/deepseek-memory-opt Issues](https://github.com/Alwaysla/deepseek-memory-opt/issues)
- Upstream discussions: [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- Plugin ecosystem: add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to plugin repositories

## License

This project is available under the [MIT License](LICENSE). Third-party dependencies and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
