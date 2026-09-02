# Agent Note: 有界记忆目录

Status: implemented

[English](2026-09-02-bounded-memory-catalog.md) | 中文

## Problem

标签化记忆只有在模型知道现有标签后才能重建归档段。单张检查点卡片并不是可靠目录，因为后续压缩可以替换它；而每次请求都注入完整归档文本又会抵消压缩收益。由持久记忆派生的目录还可能归档自身，使重复目录文本进入摘要、内容身份、spill 文件和后续召回结果。

## Decision

`@deepseek-ai/dsh-memory-catalog` 在 `ctx.systemPrompt` 注册一个名为 `memory:catalog` 的动态上下文。每次组装都读取 `AssembleContext` 提供的准确 Agent Session，折叠其 `memoryIndex`，按 `summarySeq` 从新到旧排序，并以 `entryId` 作确定性的平局规则，只渲染有界的标签和摘要文本。空索引不贡献内容。Agent Loop 使用已有的持久聚合快照物化完整动态上下文，因此目录在每个相关请求中可见，同时无需新增持久事件类型。

目录提供明确的 `maxEntries`、`maxTokens` 和 `digestMaxChars` 部署限制。完整归档对话仍只能通过 `recall_memory(tags)` 按需获取。

记忆归档按具名节投影聚合运行时上下文快照。它移除 `memory:catalog`，保留并重新渲染其他节，并把投影后的视图用于摘要输入、`entryIdFor`、spill 转录和召回重建。含目录材料的持久快照节点不进入 `memory/archived.shadowedSeqs`；通用压缩来源仍保留 Session Surface 重放所需的完整连续替换范围。

`Agent.preStep()` 会在 pre-step waterfall 之后再次协调运行时上下文。若自动压缩在该 waterfall 中遮蔽了保留的聚合快照，同一次模型请求会收到替代快照，而不是等到下一步。

## Alternatives considered

**使用检查点卡片标签进行发现。** 放弃，因为检查点卡片可被替换，不能保证目录持续存在。

**自动注入完整归档段。** 放弃，因为这会失去压缩带来的 token 和注意力收益，并使检索失去选择性。

**由 pre-step 监听器发布独立目录消息。** 放弃，因为 system-prompt 注册表已经拥有动态且可记录的运行时上下文，并提供准确的逐 Agent 组装状态。独立状态机会重复重放、更新和释放机制。

**从通用压缩来源中移除目录 seq。** 放弃，因为 Surface 替换需要完整连续的来源范围。记忆归档 seq 表示可召回内容；通用替换元数据表示位置历史，因此保持完整。

## Consequences

模型始终获得有界的近期标签清单，并且只通过 `recall_memory` 请求完整细节。目录文本不会递归积累到记忆中，而其他运行时策略仍可用于摘要和归档。目录带来少量且有界的提示词成本，并使用保守文本估算而非提供商专属分词。超出配置窗口的旧条目仍可在模型通过其他方式知道其标签时召回。
