# memory/ — 标签化记忆家族

[English](README.md) | 中文

在 [compaction](../compaction/README.zh.md) 能力缝之上分层的长期记忆家族:共享词汇、归档压缩后端、面向模型的召回工具、以及 TTL 修剪器。全部为**产品**包,均为可选装配 —— 默认组合不含其中任何一个。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`memory-core/`](memory-core/README.zh.md) | `memory/archived` 事件、`memoryIndex` 投影、内容哈希条目 id | 在 `ctx.sessionProjections` 上注册 `memoryIndex` |
| [`memory-compaction/`](memory-compaction/README.zh.md) | 对每段归档打标签、落盘、建索引的压缩后端 | 注册 `ctx.compaction` |
| [`tool-recall/`](tool-recall/README.zh.md) | 基于持久日志的 `recall_memory(tags)` 工具 | 在 `ctx.tools` 上注册 |
| [`memory-ttl-pruner/`](memory-ttl-pruner/README.zh.md) | 将老化的召回结果折叠回存根 | `ctx.memoryTtlPruner` |

## 如何组合

`memory-compaction` 取代 `compaction-basic` 成为 `ctx.compaction` 后端。每次压缩时,它向模型索取检索标签,通过 `ctx.spillStore` 写一份组织化的转录副本,并追加一条 `memory/archived` 索引记录(由 `memory-core` 拥有)。`memory-core` 的 `memoryIndex` 投影把这些记录折叠成标签目录。`recall_memory` 读该目录,并从持久日志中按条目的被遮蔽 seq 重建命中的历史段。`memory-ttl-pruner` 在召回段老化后把它折叠出上下文,而不触碰不可变的归档条目。

设计依据 —— 幂等归档、确定性召回、用完即焚 —— 见[标签化记忆 Agent Note](../../.agents/notes/implemented/feature/2026-08-26-tag-indexed-memory.zh.md)。
