# @deepseek-ai/dsh-memory-catalog

[English](README.md) | 中文

把归档记忆发布为有界、按新到旧排列的 `memory:catalog` 运行时上下文节。每次组装提示词时，该节都从当前 Agent Session 的 `memoryIndex` 派生；其中只含检索标签和摘要文本。

## 配置

- `maxEntries`（默认 `20`）限制渲染前选取的最近条目数。
- `maxTokens`（默认 `1200`）使用 Harness 保守的每 token 四字符估算，对完整渲染节设限。
- `digestMaxChars`（默认 `160`）按 Unicode 码点截断每条摘要。

## 模型体验

### 运行时记忆目录

#### 模型看到什么

存在记忆时，当前运行时上下文快照会包含类似 `tags: sqlite, migration — database migration work` 的精简列表，并提示调用 `recall_memory`。索引为空时不贡献文本。完整归档对话绝不会自动注入。

#### Token 影响

完整节同时受条目数和估算 token 数限制。`summarySeq` 较新的条目优先；相同时用 `entryId` 确定稳定顺序。

#### KV Cache 影响

只有渲染值变化时，Agent Loop 才记录新的聚合运行时上下文快照。记忆压缩会从摘要输入、归档身份、归档 seq、spill 输出和召回内容中移除 `memory:catalog`，同时保留同一快照中的其他运行时上下文节。

## 已知限制与延期工作

- Token 上限采用提示词规划所用的保守文本估算，而不是提供商专属分词。
- 匹配仍基于标签交集；目录不进行语义相关性排序。
