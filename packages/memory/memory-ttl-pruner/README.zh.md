# @deepseek-ai/dsh-memory-ttl-pruner

[English](README.md) | 中文

[标签化记忆家族](../README.zh.md)的召回记忆 TTL 修剪器。当一个 `recall_memory` 结果在模型窗口中停留超过配置的步数后,本服务把它折叠回一行简短存根,使临时召回的上下文不滞留、不再次膨胀窗口。它注册 `ctx.memoryTtlPruner`,并从 `agent/pre-step` 自驱,独立于压缩压力。

## 行为

每次 pre-step 时,`pruneSession` 扫描当前 surface 中调用 id 属于某个 `recall_memory` `tool/call` 的 `tool/result` 节点。一个结果的年龄是它之后 `step/start` 事件的数量;一旦超过 `retainSteps`,修剪器:

1. 追加一个影子定价 `compaction/prune` 事件(经 `ctx.tokenMeter` 计价),然后
2. 紧随其后同步追加一个 `tool/result` 替换,其 surface `replace` 把召回段换成一行存根,提示模型可再次 `recall_memory`。

原始 `memory/archived` 条目及其组织化副本不受影响 —— 召回可重复;折叠只回收窗口。非召回的工具结果绝不被折叠。

## 配置

| 键 | 默认 | 含义 |
|---|---|---|
| `retainSteps` | `2` | 一个 `recall_memory` 结果在被折叠回去前保持逐字的步数。`0` 会在紧接的下一步之前折叠它;更大的值使它在更多步内可用。 |

## 模型体验

### 被折叠的召回结果

#### 模型看到什么

一旦一个 `recall_memory` 结果老化超过 `retainSteps`,模型便在先前召回段的位置看到一行存根 —— `[Recalled memory folded back to free context. Call recall_memory again with the same tags to re-expand it.]`。在此之前召回段不变。模型可用相同标签调用 `recall_memory` 重新展开它。

#### Token 影响

折叠回收召回段的 token,用固定大小的存根替换它们。它绝不增加 token:存根严格小于它替换的段。

#### KV 缓存影响

折叠是一次 surface `replace`,因此从被折叠节点起使复用失效 —— 与任何压缩替换造成的 KV 失效相同。已折叠的存根不会被再次折叠,因此被折叠的结果不再贡献进一步的前缀扰动。

## 已知限制与推迟事项

- **年龄以步数计,而非 token 或墙钟时间。** `retainSteps` 是一个粗粒度窗口;基于 token 或相关性的策略被推迟。
- **一旦老化便无条件折叠。** 修剪器在折叠前不检查召回段是否仍被引用;若模型仍需要,须重新召回。
