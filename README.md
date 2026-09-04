# DeepSeek Harness 记忆优化版

[English](README.en.md) | 中文

面向长任务的 DeepSeek Harness 分支：在官方插件化 Agent Harness 上加入**标签索引记忆、按需召回、会话持续指令和按历史容量触发的上下文压缩**，让模型保留更多可恢复的信息，同时控制每次请求的上下文规模。

> 本项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 扩展，遵循 [MIT License](LICENSE)。当前仍处于开发者预览阶段，配置和持久化格式可能发生不兼容变更。

## 核心特性

- 🧠 **标签索引记忆**：压缩旧对话时生成标签和摘要，并把原始事件位置记录到持久化会话日志。
- 🔎 **按需精准召回**：模型先看到有界的 `tags + digest` 目录，仅在需要旧细节时调用 `recall_memory(tags)`。
- ♻️ **召回后自动折回**：完整召回内容保留有限 step，随后重新折叠，避免历史内容再次撑大上下文。
- 📌 **会话持续指令**：将“之后都保持回答简洁”等长期要求保存为独立会话状态，不依赖模型主动回忆。
- 🧭 **可视化指令管理**：Web UI 在 Chat 和 Trajectory 旁提供“持续指令”面板，支持新增、编辑、删除和清空。
- 📐 **历史容量压缩**：从模型窗口扣除 header、运行时上下文、输出余量和安全保留量后，再计算压缩阈值。
- 🧩 **一切皆插件**：记忆、召回、持续指令和 Web 面板均通过 [Cordis](https://github.com/cordiverse/cordis) 组合，可按 profile 替换或裁剪。

## 工作方式

```text
较早的对话历史
      │
      ▼
memory-compaction ── 生成摘要、标签和归档索引
      │
      ├── 当前上下文只保留摘要
      └── 原始事件仍保存在 Session log
                         │
                         ▼
memory-catalog ── 每次相关请求提供有界 tags + digest
                         │
               模型判断需要旧细节
                         │
                         ▼
recall_memory(tags) ── 从 Session log 重建原始片段
                         │
                         ▼
memory-ttl-pruner ── 若干 step 后再次折回
```

持续指令走独立路径：指令通过 `directive/change` 事件持久化，并作为 `session:directives` 运行时上下文注入相关模型请求。记忆目录和持续指令都是当前状态，不会被递归归档为情景记忆。

<a id="run"></a>

## 快速开始

### 环境要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm `11.7.0`
- 可用的模型凭据，例如 `DEEPSEEK_API_KEY`

<a id="run-from-source"></a>

### 从源码运行本分支

```sh
git clone https://github.com/Alwaysla/deepseek-memory-opt.git deepseek-harness
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

打开 `http://127.0.0.1:3080`。`pnpm run build` 生成仓库产物，`pnpm dsh web` 使用这些产物启动 Web UI，不会自动重新构建。

> `npx @deepseek-ai/dsh web` 安装并运行的是官方 npm 包，不包含本分支的记忆和持续指令扩展。

## 使用持续指令

### Web UI

进入一个会话，打开与 Chat、Trajectory 同级的“持续指令”面板，即可添加、编辑、删除或清空当前会话的指令。刷新页面或压缩原始用户消息后，未删除的指令仍然有效。

### 命令

```text
/directive list
/directive set <key> <JSON-string value>
/directive delete <key>
/directive clear
```

示例：

```text
/directive set response.concise "回答尽量简洁"
```

标准、Code 和 Cordis agent preset 还向模型提供 `list_directives`、`set_directive` 与 `remove_directive` 工具。变更工具只接受当前顶层用户消息中的明确持久化或删除意图；一次性要求、旧消息、网页内容、召回文本和工具输出不能授权持久变更。

## 记忆召回

记忆目录会自动以精简的标签和摘要进入相关请求，但不会自动加载所有归档全文。模型判断当前任务依赖某段旧信息时，才会调用：

```text
recall_memory({ tags: ["session-directives", "compaction"] })
```

召回内容以持久化 Session log 为事实来源。外部 transcript 仅用于检查，不决定召回结果。

## 默认 Web 配置

```yaml
- insert:
    - id: memory-compaction
      name: '@deepseek-ai/dsh-memory-compaction'
      config:
        thresholdRatio: 0.45
        retainRatio: 0.12
        maxTokens: 8192
        compactionRetries: 1

    - id: memory-catalog
      name: '@deepseek-ai/dsh-memory-catalog'
      config:
        maxEntries: 20
        maxTokens: 1200
        digestMaxChars: 160

    - id: memory-ttl-pruner
      name: '@deepseek-ai/dsh-memory-ttl-pruner'
      config:
        retainSteps: 2
```

参数含义：

- `thresholdRatio`：历史消息达到可用历史容量的 45% 时触发主动压缩。
- `retainRatio`：压缩后目标保留约 12% 的历史容量。
- `maxTokens`（memory-compaction）：摘要模型单次输出上限，不是触发阈值或上下文窗口大小。
- `maxEntries` / `maxTokens` / `digestMaxChars`（memory-catalog）：限制模型每次看到的记忆目录规模。
- `retainSteps`：完整召回结果在上下文中保留的 step 数。

实际装配以 [`packages/bundle/web-app/cordis.patch.yml`](packages/bundle/web-app/cordis.patch.yml) 为准。

## 验证功能

1. 在“持续指令”面板添加一条指令并刷新页面，确认它仍然存在。
2. 继续发送消息，确认指令出现在模型运行时上下文并影响回复。
3. 删除指令并刷新，确认它不再出现，也不再约束后续回复。
4. 进行足够长的会话触发压缩，确认记忆目录出现 `tags + digest`。
5. 要求模型继续依赖早期细节，确认它通过 `recall_memory` 取回归档片段。

## 文档

- [当前工作区的记忆、持续指令与压缩设计说明](Markdown/Deepseek-harness-memory-opt.md)
- [标签索引记忆 Agent Note](.agents/notes/implemented/feature/2026-08-26-tag-indexed-memory.zh.md)
- [有界记忆目录 Agent Note](.agents/notes/implemented/feature/2026-09-02-bounded-memory-catalog.zh.md)
- [会话指令与历史容量压缩 Agent Note](.agents/notes/implemented/architecture/2026-09-03-session-directives-and-history-capacity-compaction.zh.md)
- [DeepSeek Harness 架构](docs/architecture.zh.md)
- [Web UI 使用指南](docs/user/guide/index.zh.md)

## 开发

```sh
pnpm run typecheck
pnpm run test
pnpm run test:gui
pnpm run doc-sync
```

修改代码前请阅读[开发指南](docs/development.zh.md)、[贡献指南](CONTRIBUTING.zh.md)和面向 agent 的 [AGENTS.md](AGENTS.md)。

## 社区与支持

- 本分支问题与建议：[Alwaysla/deepseek-memory-opt Issues](https://github.com/Alwaysla/deepseek-memory-opt/issues)
- 上游讨论：[DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)
- 插件生态：为插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题

## 许可证

本项目采用 [MIT License](LICENSE)。第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
