# Agent Note:压缩之上的标签化记忆

Status: implemented

[English](2026-08-26-tag-indexed-memory.md) | 中文

## 问题

压缩通过把较旧的一段历史替换为一张简洁的摘要卡片,使长对话保持在上下文窗口内。被遮蔽的事件仍留在持久日志中,但此后模型无法触及 —— 唯一进入窗口的只有摘要。对于需要重访早先话题的工作(二十轮前改过的某个文件、其依据已被压缩掉的某个决策),模型无法把细节取回,除非用户重新解释。

我们想要一种模型可以**按需检索**的记忆:让上下文顶部保持最小,但在需要时让模型按主题把一段归档拉回,并在用完后让它再次离开。三条性质不可妥协:

1. **幂等归档** —— 召回一段并稍后重新压缩它,绝不能创建第二份近乎重复的归档;存储与索引必须由**不同**段的数量界定,而非召回次数。
2. **确定性召回** —— 被召回的段必须在会话重放下精确复现,不依赖任何外部可变状态。
3. **条目不可变、一次性展开** —— 被召回的段是临时展开;把它折叠回去绝不能改动原始归档。

## 决策

`packages/memory/` 下四个可选装配包,分层于既有的[压缩缝](2026-06-18-compaction-capability-seam.zh.md)之上。默认组合均不含。

### `memory-core` —— 共享词汇(无策略)

拥有仅记录日志的 `memory/archived` `SessionEventMap` 成员、把这些记录折叠成标签目录的 `memoryIndex` 会话投影、以及 `entryIdFor(messages)`。条目 id 是被遮蔽消息的角色与内容的**内容哈希**(排除消息 id),这正是归档幂等的原因:被召回并重新归档的一段哈希为同一 id,因此索引(按 id 后写覆盖)与落盘副本绝不重复。

### `memory-compaction` —— 归档后端

`MemoryCompactionEngine extends BasicCompactionEngine`,原封不动地复用其重放/计价/事务机制。它只定制两处缝:

- **打标签**,经新增到 `BasicCompactionEngine` 的 `protected summaryInstruction()` 钩子(见下):子类追加一条指令,要求模型在检查点末尾输出一行 `TAGS:`,然后把该行解析剥离,保留干净的摘要卡片。
- **提交后建索引**:`memory/archived` 记录在 `super.compactRegion()`/`super.compactNow()` 提交*之后*追加,因为 `summarize()` 收不到被遮蔽的 seq —— 只有已提交的 `CompactionResult` 携带它们。提交后追加也保证记录绝不指向未被遮蔽的段,且无孤儿风险。

被遮蔽段还会通过 `ctx.spillStore` 以组织化、按标签命名的转录逐字写出 —— 即"文件系统副本" —— 但该副本**不在**召回路径上。

### `tool-recall` —— 面向模型的检索

`recall_memory(tags)` 读取 `memoryIndex`,按标签交集(大小写不敏感)匹配,并经 `session.deriveEventMessage` **从持久日志按各条目的 `shadowedSeqs`** 重建每段 —— 而非从 spill 副本。这正是确定性召回的来源:重建的内容以普通的、被记录的 `tool/result` 进入上下文,它读取的 seq 永不离开日志,因此重放精确复现。spill 副本仅作为人可检视 / 模型可 grep 的产物。

### `memory-ttl-pruner` —— 一次性折叠

一个由 `agent/pre-step` 驱动的独立服务(独立于压缩压力,仿照 `compaction-tool-result-pruner`)。它通过把 `recall_memory` 结果与其 `recall_memory` `tool/call` 配对来识别它们,通过计数结果之后的 `step/start` 事件来计其年龄,一旦超过 `retainSteps`,便用一个 `compaction/prune` 影子定价事件加一个把 `tool/result` `replace` 成一行存根的替换,把每个折叠回去。`memory/archived` 条目不受影响 —— 召回可重复。

### 对 `compaction-basic` 的使能改动

为让 `summarize()` 真正可被需要不同检查点形状的子类覆写,`compaction-basic` 现在:导出 `SummarizationInput`/`SummaryResult`;为 `summarizeWithLlm` 贯通一个 `instruction` 参数(默认 `COMPACTION_INSTRUCTION`);并暴露一个默认 `summarize()` 调用的 `protected summaryInstruction()` 钩子。行为保持不变 —— `compaction-basic` 既有的 122 个测试全部原样通过。

## 考虑过的替代方案

- **在 `summarize()` 内发出专门的 `memory/archived` 事件。** 否决:`summarize()` 缺少被遮蔽 seq,且事务中途追加在事务后续失败时有孤儿记录风险。从 `compactRegion`/`compactNow` 覆写中提交后建索引无孤儿且有 seq。
- **召回读取 spill 文件。** 作为真相源否决:它使召回依赖外部可变文件系统状态并削弱重放。日志已在记录的 seq 处保存被遮蔽事件,因此召回从那里重建;spill 文件仅作为用户要求的组织化落盘产物保留。
- **把标签/locator 编码进 `compaction/summary` 事件。** 不可行 —— 该事件形状固定在缝包中 —— 且从面向模型的卡片解析它们很脆弱。`memory-core` 中专门的 `memory/archived` 记录是干净的归属地。
- **一个系统提示标签目录 section。** 推迟:它需要带会话访问的 agent 作用域装配,而每张卡片的 `TAGS`/召回提示已告诉模型什么可召回。后续版本可加聚合目录。

## 后果

- **无论会话多长,顶部保持有界**:最近尾巴(`retainTokens`)+ 小摘要卡片 + 召回工具,细节在磁盘/日志中,仅按需拉回并在 `retainSteps` 后折出。
- **推迟**:老摘要卡片/索引条目的分层 roll-up;自动按标签召回(v1 仅模型驱动);基于 token/相关性的 TTL;组织化副本与重建转录中的非文本块。
- **新的模型可见面**(`recall_memory` 工具、`memory/archived` 事件)由各包的无密钥真实组合测试覆盖;SessionEventMap 的新增反映在持久化目录中。
