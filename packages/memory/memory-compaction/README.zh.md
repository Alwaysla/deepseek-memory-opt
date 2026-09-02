# @deepseek-ai/dsh-memory-compaction

[English](README.md) | 中文

[标签化记忆家族](../README.zh.md)的归档压缩后端:`MemoryCompactionEngine` 继承 [`BasicCompactionEngine`](../../compaction/compaction-basic/README.zh.md),并在每次压缩时:(1) 向模型索取检索标签,(2) 通过 `ctx.spillStore` 写一份被遮蔽段的组织化转录副本,(3) 在事务提交后追加一条 `memory/archived` 索引记录。它注册 `ctx.compaction`,取代 `compaction-basic` 成为后端。

它复用 `compaction-basic` 的 token 压力、保留策略和持久事务机制。摘要调用前，它会从选中消息中移除 `memory:catalog` 运行时上下文节；同一聚合快照中的其他节会保留。

## 它拥有什么

- **打标签** —— `summaryInstruction()` 追加一条指令,要求模型在检查点末尾输出一行 `TAGS:`。引擎把该行解析为 3–7 个小写标签,保留一张干净的摘要卡片(`TAGS:` 行绝不进入模型),并在模型未产出标签时回退为单个 `general` 标签。
- **组织化副本** —— 归档可见段以带角色标签的转录形式，通过 `ctx.spillStore.saveText`（必需注入）按标签派生的文件名写入。locator 记录在索引条目上。
- **建索引** —— 一条 `memory/archived` 记录（由 [`memory-core`](../memory-core/README.zh.md) 拥有）在 `compactRegion`/`compactNow` 提交后追加，携带标签、摘要、归档可见 seq 与 locator。因为建索引在提交后运行，记录绝不指向未被遮蔽的段。通用压缩结果仍保留完整的位置替换来源。
- **目录排除** —— `memory:catalog` 节会在摘要、哈希、spill 输出和归档索引之前移除。若聚合运行时上下文快照还含其他节，则会保留并重新渲染这些节；由于持久节点曾含目录材料，该节点的 seq 不进入记忆归档。
- **幂等** —— 条目 id 为 `entryIdFor(被遮蔽消息)`,即内容哈希。重新归档同一段(例如它被召回后又折叠回去)复用同一 id,因此目录和组织化副本绝不重复。

自动压力/溢出路径与手动 `/compact` 路径都会归档。

## 配置

`BasicCompactionConfig` 不变 —— 本后端不新增配置键。`spillStore` 被加入必需的 `inject` 列表。

## 模型体验

### 对话历史

#### 模型看到什么

模型看到的检查点是摘要卡片 —— 与 `compaction-basic` 产出相同的 `<compacted-summary>` 包裹形状,只是去掉了被解析出的末尾 `TAGS:` 行。卡片替换选中的较旧范围,其后跟随被保留的最近单元。卡片的摘要写明该段归档所用的标签,使模型知道可以用 `recall_memory` 拉回什么。

#### Token 影响

摘要卡片替换较旧范围而非追加,减少未来的输入历史;它严格小于它所遮蔽的段。`TAGS:` 行在卡片落地前被剥离,因此归档后不产生成本。

#### KV 缓存影响

是替换而非仅追加。每个检查点从第一个被替换的历史 token 起使复用失效;该范围之前不变的请求前缀仍可复用 —— 与 `compaction-basic` 相同。

### 辅助摘要请求

#### 模型看到什么

摘要模型收到移除 `memory:catalog` 节后的选中对话，其后是基础压缩指令加一条追加指令：用一行 3–7 个小写检索标签的 `TAGS:` 行结束检查点。聚合运行时上下文快照中的其他节仍会保留。对话模型永不看到这个私有请求；只有返回文本（去掉被解析的 `TAGS:` 行）被存储。

#### Token 影响

复用对话前缀,因此辅助调用唯一的新输入是指令加标签指令。标签指令为该最终用户消息增加几个 token。

#### KV 缓存影响

重放的前缀像 `compaction-basic` 一样精确复用 provider 的热缓存;追加的标签指令是末尾的新输入,不改动更早的前缀。

## 已知限制与推迟事项

- **无分层 roll-up。** 反复压缩会合并前一个检查点(继承自 `compaction-basic`),但归档索引条目及其摘要卡片尚未被汇总成更粗的条目,因此其数量随很长的会话增长。
- **组织化副本仅含文本。** `renderTranscript` 保留文本块;被遮蔽段中的图像及其它非文本内容不进入落盘副本。召回从日志重建,不受影响。
