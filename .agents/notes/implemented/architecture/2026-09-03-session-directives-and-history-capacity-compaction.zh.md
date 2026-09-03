# Agent Note: 会话指令与历史容量压缩

Status: implemented

[English](2026-09-03-session-directives-and-history-capacity-compaction.md) | 中文

## Problem

用户的长期指令是活动策略，而不是情景事实。仅通过标签记忆恢复指令会让遵循行为依赖召回，而永久保留原始请求则会让策略生命周期依赖对话压缩。自动持久化还需要严格的授权规则：旧轮次、召回文本、工具输出、Web 内容和 subagent 输出都可能包含祈使措辞，但不能因此授权一项持久偏好。

压缩（compaction）也存在相关的计量问题。模型上下文窗口除了可压缩的对话历史，还必须容纳请求 header、当前运行时上下文、输出余量和安全保留量。若对整个模型窗口应用阈值与保留比例，固定请求材料就会被误算为可回收历史，触发时机会随之错误。提供方 usage 总量也无法修复这种分区，因为其 bucket 不透明，且不一定对应 harness 独立估算的消息区段。

## Decision

### 指令是会话所有的持久当前状态

`@deepseek-ai/dsh-session-directives` 拥有会话作用域的指令列表。每个条目包含稳定的 `key`、模型可见的 `value`、生产方 `source` 和字面值 `scope: 'session'`。设置已有 key 会替换其值，不会扩大列表。每次成功的设置、删除或清空都会追加一个带版本的 `directive/change` 事件，其中包含变更后的完整列表；回放采用后写覆盖，`sessionDirectives` projection（投影）向客户端暴露同一状态。

该服务把活动列表渲染为具名 `session:directives` 运行时上下文区段。聚合运行时上下文 `user/message` 快照仍是模型可见的持久表示，因此即使建立指令的用户消息被替换，指令仍会存续并保持可重建，而无需把策略移入 `EpochHeader.system`。

默认限制为 12 个条目、完整渲染区段（包括包装文本和归因）256 个估算 token，以及每个 value 200 个 Unicode code point。超限变更会在追加事件前失败。服务不会截断、摘要、驱逐或静默省略指令。

### 变更授权来自当前直接用户轮次

`@deepseek-ai/dsh-session-directive-consumers` 提供显式 `/directive` 操作以及面向模型的列出、设置和删除工具。模型变更只有在以下条件全部满足时才会被接受：调用者是活动 driver 中的精确根 agent，且开放轮次包含当前 `user/message`，其 source kind 为 `user`。召回记忆、注入的插件上下文、工具结果、Web 内容、subagent 输出、先前轮次和模型推断都不能建立这种授权。

自动识别刻意保持严格。它只检查当前根 agent 的直接用户消息，并识别受支持的精简回复偏好。显式的未来措辞会将其持久化；显式的单次回复措辞不会持久化。含糊的偏好措辞通过 user-question 服务确认；若确认渠道不可用，则发出通知要求模型确认，而不是变更状态。V1 不把指令提升到工作区或全局作用域。

Web 客户端把 `sessionDirectives` 投影到会话作用域的 `conversation.view` 条目，order 为 20，与 order 0 的 Chat 和 order 10 的 Trajectory 并列。新增、编辑、删除和清空操作使用与其他用户控制相同的 `/directive` 命令路径，而不是第二套变更 API。

### 当前状态上下文不是情景记忆

记忆归档把 `memory:catalog` 与 `session:directives` 视为当前状态运行时区段。它会在摘要输入、归档身份、spill transcript（文本记录）、召回重建、归档 token 计量和 `memory/archived.shadowedSeqs` 中移除这些区段；同一聚合快照中的其他情景区段仍会保留。通用压缩替换来源仍记录完整的连续源范围。

这扩展了[有界记忆目录决策](../feature/2026-09-02-bounded-memory-catalog.zh.md)中的隔离规则：目录负责宣传可召回的情景条目，指令则主动约束每个相关请求。两个当前状态区段都不会递归成为情景记忆。

### 压缩预算只计算可回收历史

`agent/pre-dispatch` 在路由和请求组装完成后、`llm.stream` 之前暴露最终规范 header 与完整模型可见消息。如果监听器改变了持久请求输入，它返回 `{ kind: 'retry' }`，让 agent loop（智能体循环）重新构建，而不是分发过期请求。

自动主动压缩在此扩展点计量，并包含当前边界消息。它把请求划分为可压缩历史和固定请求材料。运行时上下文快照节点属于固定材料，而不是历史。对于精确的已路由模型：

```text
historyCapacity = contextWindow - fixedRequestTokens - safetyReserveTokens
thresholdTokens = floor(historyCapacity × thresholdRatio)
retainTokens = floor(historyCapacity × retainRatio)
```

`fixedRequestTokens` 包含规范 header、非历史消息材料和请求输出余量。运行时上下文从 `historyTokens` 中排除，因此不会同时作为固定开销和历史重复计数。`safetyReserveTokens` 默认为 0，并参与顶层策略和精确提供方/模型策略。现有 Web 记忆策略保持 `thresholdRatio: 0.45`、`retainRatio: 0.12`、`maxTokens: 8192` 与 `compactionRetries: 1`；`maxTokens` 仍是摘要器输出上限，而不是历史预算。

Token meter 可以使用提供方 usage 作为聚合请求压力的锚点，但压缩绝不会用不透明的提供方总量减去独立估算的 surface token 来推导固定开销。它会分别估算最终规范 header 与消息分区。由提供方确认的 `CONTEXT_WINDOW_EXCEEDED` 恢复仍不依赖容量，绕过主动比例，并且只在持久 surface 取得进展后重试。

## Verification

指令服务与消费方测试固定完整状态回放、稳定 key 替换、活动限制校验、失败写入原子性、直接用户持久化授权、措辞极性与时长分类、命令与工具行为、运行时渲染、投影生命周期和真实 Loader 组合。客户端测试固定会话投影、命令变更、不可变编辑 key、同级视图顺序和 dispose（资源释放）。记忆测试固定当前状态排除，同时保留无关聚合区段及其来源序号。

压缩测试固定目标策略校验、扣除固定请求与安全保留量后的精确历史容量缩放、最终 pre-dispatch 时机、由持久重试驱动的请求重建、运行时上下文分区和提供方溢出恢复。

## Alternatives considered

**把指令视为情景记忆。** 不予采纳，因为召回是选择性的且由模型发起，而活动指令必须在每个相关请求中提供，直至被显式修改或删除。

**从任何偏好式措辞或任何上下文来源推断持久性。** 不予采纳，因为含糊措辞和不受信任的引用指令会静默获得持久权限。持久化需要显式未来措辞或直接确认，并且只有当前顶层用户轮次可以授权变更。

**在 V1 增加工作区或全局作用域。** 不予采纳，因为其所有权、继承、授权和删除语义与会话日志不同。持久格式把 V1 作用域固定为 `session`。

**截断、摘要或驱逐超限指令。** 不予采纳，因为静默改写会改变策略语义。完整候选状态要么满足限制，要么显式失败。

**基于完整上下文窗口缩放压缩比例。** 不予采纳，因为 header、运行时策略、输出余量和保留量都不是可回收对话历史。

**用提供方总量减估算 surface 来推导固定开销。** 不予采纳，因为提供方 usage bucket 不透明，而减法会混合不兼容的计量。

**在 `agent/pre-step` 执行精确主动压力检查。** 不予采纳，因为此时路由、header 组装、运行时上下文协调、工具和最终边界消息尚未全部固定。`agent/pre-dispatch` 观察的才是实际将被发送的请求。

**把指令控制放进设置页或独立应用栏。** 不予采纳，因为指令属于单个对话，并使用其投影与命令生命周期。同级 `conversation.view` 让其作用域在 Chat 与 Trajectory 旁保持可见。

## Consequences

长期指令在其原始文本被压缩后仍保持活动，通过稳定 key 和完整输出限制维持有界，并可在同一会话中通过模型与 Web 路径检查和删除。严格授权规则放弃了广泛的自然语言偏好提取；若不使用显式操作，则只支持保守识别器。

压缩阈值与保留尾部预算跟随每个已路由模型窗口中历史实际可占用的部分。更大的运行时策略或输出余量会在最终请求边界立即缩小历史容量，而不会重复计数这些 token。额外的 pre-dispatch 扩展点和重试可能在压缩后重建请求，但避免了按过期计量分发。

本说明部分取代[已路由模型上下文与压缩策略](2026-07-20-routed-model-context-and-compaction-policy.zh.md)和[调用后压缩压力与上下文溢出恢复](2026-07-10-after-call-compaction-pressure-and-overflow-recovery.zh.md)中的主动压缩分母与时机。适配器拥有容量、精确目标策略、模型无关 token meter 和提供方确认的溢出恢复仍以这些说明为准。
