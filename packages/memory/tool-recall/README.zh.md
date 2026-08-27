# @deepseek-ai/dsh-tool-recall

[English](README.md) | 中文

[标签化记忆家族](../README.zh.md)中面向模型的 `recall_memory` 工具。给定检索标签,它返回压缩期间归档在这些标签下的会话历史段,从持久会话日志重建。注册本插件会在 `ctx.tools` 上添加该工具。

## 行为

- **输入** —— `recall_memory({ tags: string[] })`。检查点卡片会列出它归档时用的标签;模型传入其中一个或多个。
- **匹配** —— 通过 `ctx.sessionProjections` 读取 `memoryIndex` 投影(可选:无该缝 ⇒ 无记忆),并大小写不敏感地选出标签与请求相交的条目。
- **重建** —— 对每个命中条目,从持久日志中按条目的 `shadowedSeqs`(经 `session.deriveEventMessage`)重建一份带角色标签的转录,而**非**从落盘副本重建。因此召回在重放下精确复现:工具结果本身是被记录的 `tool/result`,它读取的 seq 永不离开日志。
- **返回** —— 一个规范值 `{ memories: [{ entryId, tags, digest, content }] }`,渲染为面向模型的 `<recalled-memory>` 块,或一条简短的"无匹配归档记忆"提示。

无归属 agent 会话的调用会被拒绝 —— 该工具读取按会话的状态,非 agent 调用者没有。

## 模型体验

### 工具 schema

#### 模型看到什么

模型看到生成的 [`recall_memory` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-recall)。

#### Token 影响

在该工具可见的每个请求上有固定的 schema 成本。

#### KV 缓存影响

在定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使该 schema 起的复用失效。

### 召回结果

#### 模型看到什么

一次 `recall_memory` 调用返回每个命中的、从持久日志重建的归档段,包裹在 `<recalled-memory tags="…">` … `</recalled-memory>` 文本块中,或返回提示 `No archived memory matched those tags.`。无归属 agent 会话的调用返回 `Error: recall_memory requires an agent session`。重建的转录仅含文本。

#### Token 影响

被召回的段以大致等于原段文本的大小重新进入上下文,并停留到 TTL 修剪器把它折叠回去或压缩再次遮蔽它为止。

#### KV 缓存影响

仅追加:结果跟在可复用的请求前缀之后,不使既有条目失效。稍后 [`memory-ttl-pruner`](../memory-ttl-pruner/README.zh.md) 的折叠是一次 surface replace,从被折叠节点起使复用失效。

## 已知限制与推迟事项

- **仅模型驱动召回。** 模型必须自己选择用检查点卡片上看到的标签调用 `recall_memory`;尚无自动的按标签匹配召回(一项推迟的家族目标)。
- **仅文本重建。** 被遮蔽段中的非文本块不进入重建的转录。
