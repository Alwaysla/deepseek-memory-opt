# @deepseek-ai/dsh-memory-core

[English](README.md) | 中文

[标签化记忆家族](../README.zh.md)的共享词汇:`memory/archived` 会话事件、`memoryIndex` 投影、以及内容哈希的 `entryIdFor` 身份。本包不拥有任何策略 —— 它是归档后端、召回工具、TTL 修剪器共同依赖的声明归属地。

## 提供什么

- **`memory/archived` 事件** —— 一个仅记录日志的 `SessionEventMap` 成员(无 `surfaceOp`),携带一段归档的 `entryId`、`tags`、`digest`、`shadowedSeqs`、`shadowedTokenCount`、`summarySeq`,以及组织化副本的 `locator`。由 `memory-compaction` 在压缩事务提交后追加,因此每条记录都指向一段已在 surface 上被遮蔽的历史。纯信息性:该段的原始事件仍留在日志的 `shadowedSeqs` 处,丢失记录只丢标签索引,绝不影响可重建性。
- **`memoryIndex` 投影** —— 把每条 `memory/archived` 记录折叠成 `{ entries: Record<entryId, MemoryEntry> }`,按 id 后写覆盖。当投影缝被组合时注册于 `ctx.sessionProjections`;无该缝的无头装配不受影响。客户端可见,UI 可读取整个目录。
- **`entryIdFor(messages)` / `EntryId`** —— 一段历史的内容哈希身份。只对消息角色和内容做哈希(排除消息 id),因此被召回并重新归档的同一段与原段哈希相等,归档保持幂等。
- **`RECALL_TOOL_NAME`** —— 召回工具的模型可见名称,由注册它的工具与识别其结果的修剪器共享。

## 模型体验

无,因为本包只声明仅记录日志的 `memory/archived` 事件与 `memoryIndex` 投影;召回工具与归档压缩后端拥有一切面向模型的效果。

#### KV 缓存影响

无直接影响。本包不装配任何 provider 请求;把归档段渲染进请求的兄弟包拥有由此产生的前缀变化。

## 已知限制与推迟事项

- **`memoryIndex` 值携带全部归档条目。** 在会话规模下可接受,但很长的会话会累积条目;未来版本可能对老条目分页或做汇总(见家族的分层 roll-up 推迟项)。
