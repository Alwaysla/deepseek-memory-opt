# `@deepseek-ai/dsh-client-ui-session-directives`

[English](README.md) | 中文

这个 Client 插件在 Chat 与 Trajectory 旁新增 **持续指令** 标签页。它读取 Host 计算的 `sessionDirectives` projection，并通过现有会话命令 RPC 执行变更。

## Projection 与命令

Projection 是完整值 `{ directives }`；每条记录包含 `key`、`value`、`source` 和固定的 `session` scope。视图执行 `/directive set <key> <JSON value>`、`/directive delete <key>` 和 `/directive clear`。Host 始终是权威来源：命令成功后，只有 projection 更新才会使结果显示在界面中。

每条记录提供编辑和删除操作，标题栏提供新增和清空操作。命令准入错误与传输错误会保留在标签页中显示。

## 模型体验

间接影响：本包显示并编辑 Host session-directives 能力的 projection，模型可见上下文由该 Host 能力负责。

#### KV Cache 影响

这个 Client 包不直接影响模型请求或 KV cache 复用。

## 已知限制与暂缓事项

- **Host 能力可选**：缺少 `sessionDirectives` 或 `/directive` 时，标签页会显示空状态或命令错误；Client 不模拟持久化。
