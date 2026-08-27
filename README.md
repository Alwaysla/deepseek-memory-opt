# DeepSeek Harness with Memory Optimization

English | [中文](README.zh.md)

During long-running tasks, context explosion is often one of the most troublesome problems. Without compaction, the AI gradually becomes increasingly incoherent; with compaction, there is always the concern that critical information may be lost, causing the AI to make a mess of things again. This led me to consider a context-preservation mechanism designed for long-running tasks:

When context usage exceeds a configured threshold, the historical context is categorized, packaged, and persisted to disk. It is then replaced in the active context with a tag that records only its index. When the current task needs that portion of the context, the system retrieves it from the log using the tag. After it has been used, the retrieved content is put away again and archived under a new context tag. This provides a form of memory management that gives the AI access to more extensive, longer-term memory without causing the active context to explode.

This implementation benefits from two important DeepSeek Harness plugins. The first is subagent, which delegates context-polluting tasks to subagents so that the main agent retains only conclusions and critical information. The second is compaction-basic, which provides a simple context-discarding mechanism. When current context usage exceeds a configured threshold, part of the context is folded into a labeled placeholder, thereby reducing the size of the active context.

However, this compaction mechanism only reduces the current conversation context while leaving the original log unchanged; it does not provide a way to index historical context.

My implementation adds categorization during folding, on-demand recall, and re-archival after recalled content has been used.

> **Note**: This is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) with additional features. All modifications follow the MIT License.
>
> **Added Features**:
> - **Tag-indexed memory**: Long-term memory system with on-demand retrieval of archived conversation spans
>   - `memory-core`: Content-hash indexed archival events and memory projection
>   - `memory-compaction`: Tag-aware compaction backend that archives and indexes spans
>   - `tool-recall`: `recall_memory(tags)` tool for deterministic span reconstruction
>   - `memory-ttl-pruner`: Automatic fold-back of aged recalled content
>
> For details, see [Agent Note: Tag-indexed memory](.agents/notes/implemented/feature/2026-08-26-tag-indexed-memory.md).

---

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/Alwaysla/deepseek-memory-opt.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
