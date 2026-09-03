# @deepseek-ai/dsh-session-directive-consumers

[English](README.md) | 中文

这是 [`ctx.sessionDirectives`](../session-directives/README.zh.md) 的用户命令、模型工具和保守的简洁回复偏好识别器。所有变更都调用领域服务；本包不直接追加 directive 事件，也不自行渲染 directive 上下文。

## 命令

`/directive` 和 `/directive list` 返回当前列表。`/directive set <key> <JSON-string value>` 设置一条会话级 directive，`/directive delete <key>` 删除一条，`/directive clear` 清空全部。key 只能使用小写字母、数字、点、下划线和连字符。value 必须是 JSON 字符串，使空格和转义只有一种无歧义语法。命令拒绝图片。

## 工具与权限

`list_directives()` 读取调用方会话。`set_directive(key, value)` 和 `remove_directive(key)` 修改该会话。变更要求调用方是当前活动驱动器中的精确 live、running agent，并且当前开放轮次属于 runtime root，且包含由 Host 证明的直接用户消息。子 Agent、插件消息、过期 Agent、已关闭轮次和自治轮次都不能授予权限。

## 自动识别

pre-step 识别器只支持一个稳定推断 key：`response.concise`。只有当简洁回复偏好与明确的未来持续措辞同时出现时才会持久化，例如 “from now on keep responses concise” 或“以后回答都简洁一些”。`这次`、`本次`、`for this response` 等单轮措辞绝不持久化。对于含糊的偏好措辞，若可选的 `ctx.userQuestions` 可用，识别器会请求确认；否则向模型加入一条不变更状态的提示，要求先确认。无关或仅描述性的措辞不产生结果。

识别只检查 runtime root 的一个当前 `{ kind: 'user' }` 消息。插件、模型、工具、子 Agent 以及包含多个直接用户消息的批次都会被忽略。

## 组合

在 Host 挂载根入口以提供 `/directive` 和直接用户消息识别；仅在需要模型控制能力的 preset 中挂载工具子路径：

```yaml
# Host
- name: '@deepseek-ai/dsh-session-directive-consumers'

# Agent preset
- name: '@deepseek-ai/dsh-session-directive-consumers/tools'
```

两个入口都消费 Host 拥有的 `sessionDirectives` 服务。根入口还消费 `agents` 和 `commands`；`userQuestions` 是可选服务，用于显示确认问题。工具入口消费有作用域的工具注册表，不发布服务。

## 模型体验

### Directive 控制与识别提示

#### 模型看到的内容

生成的 `list_directives`、`set_directive` 和 `remove_directive` schema 提供明确的仅会话操作。变更工具要求当前顶层直接用户消息包含相符的持续设置或移除措辞；其他请求内容或工具内容不能授权变更。成功结果是紧凑 JSON。当含糊的简洁回复措辞无法使用确认通道时，当前请求还会收到一条提示，说明偏好尚未持久化，并要求模型在变更前确认。

#### Token 影响

工具在可见时增加固定 schema 输入成本。列表和变更会增加紧凑结果 token。回退识别提示按条件加入；明确的持久偏好识别不会增加单独消息，因为领域拥有的运行时上下文会表示已接受状态。

#### KV Cache 影响

只要可见性和定义不变，schema 前缀保持稳定。directive 变更会在后续请求中改变领域拥有的运行时上下文。回退提示只追加到当前请求。

## 已知限制与暂缓事项

- **仅推断一种偏好**：自动识别仅支持简洁回复；其他 directive 必须使用显式命令或工具调用。
- **仅会话范围**：V1 不提供 workspace directive、undo 或 feedback。
- **确认依赖 provider**：没有 `ctx.userQuestions` 时，含糊措辞会产生不变更状态的模型提示，而不会阻塞或猜测。
