# memory/ — 标签化记忆家族

[English](README.md) | 中文

在 [compaction](../compaction/README.zh.md) 能力缝之上分层的长期记忆家族：共享词汇、归档压缩后端、有界的模型可见目录、召回工具和 TTL 修剪器。这些均为**产品**包，Web 应用会把它们组合起来。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`memory-core/`](memory-core/README.zh.md) | `memory/archived` 事件、`memoryIndex` 投影、内容哈希条目 id | 在 `ctx.sessionProjections` 上注册 `memoryIndex` |
| [`memory-compaction/`](memory-compaction/README.zh.md) | 对每段归档打标签、落盘、建索引的压缩后端 | 注册 `ctx.compaction` |
| [`memory-catalog/`](memory-catalog/README.zh.md) | 有界的近期 `tags + digest` 运行时上下文节 | 在 `ctx.systemPrompt` 注册 `memory:catalog` |
| [`tool-recall/`](tool-recall/README.zh.md) | 基于持久日志的 `recall_memory(tags)` 工具 | 在 `ctx.tools` 上注册 |
| [`memory-ttl-pruner/`](memory-ttl-pruner/README.zh.md) | 将老化的召回结果折叠回存根 | `ctx.memoryTtlPruner` |

## 如何组合

`memory-compaction` 取代 `compaction-basic` 成为 `ctx.compaction` 后端。每次压缩时，它向模型索取检索标签，通过 `ctx.spillStore` 写一份组织化转录副本，并追加由 `memory-core` 拥有的 `memory/archived` 索引记录。`memory-core` 把这些记录折叠进 `memoryIndex`；`memory-catalog` 在相关模型请求中投影有界的近期 `tags + digest` 视图，`recall_memory` 再按需从持久日志重建选中的历史段。`memory-ttl-pruner` 随后把召回内容折叠出去，而不触碰归档条目。目录文本不会进入记忆摘要、归档身份、归档 seq、spill 副本或召回输出。

设计依据 —— 幂等归档、确定性召回、用完即焚 —— 见[标签化记忆 Agent Note](../../.agents/notes/implemented/feature/2026-08-26-tag-indexed-memory.zh.md)。
