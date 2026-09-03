# @deepseek-ai/dsh-session-directives

[English](README.md) | 中文

仅限 Host 的持久同会话指令。`ctx.sessionDirectives` 按稳定键列出、设置、移除和清除指令；每个已接受的变更都会追加包含完整状态的 `directive/change` 事件，重放采用最后写入优先语义。

## 配置

```yaml
- id: session-directives
  name: '@deepseek-ai/dsh-session-directives'
  config:
    maxEntries: 12
    maxTokens: 256
    valueMaxChars: 200
```

所有限制都必须是正安全整数。`maxEntries` 限制活动键数量，`valueMaxChars` 按 Unicode 码点计算单个值的长度，`maxTokens` 使用包内固定的每四字符一个 token 估算来限制完整渲染内容。超过任何限制的写入都会抛出 `SessionDirectivesError`，且不会追加事件。超过当前部署限制的回放状态会在列表、projection 或模型渲染前被拒绝。

## 语义

每条指令包含 `key`、`value`、`source` 和 V1 字面量作用域 `session`。字符串值会被去除首尾空白，并且必须保持非空。设置已有键会在原位置替换，设置新键会追加到末尾。移除不存在的键和清除空状态都是无操作。服务读取会从会话日志重建并返回分离的值。

可选的 `sessionDirectives` SessionProjection Host/Wire 键包含完整活动列表。`./invariant` 配套模块会在发布前拒绝格式错误的持久载荷，并在挂载时校验已有会话。

## 模型体验

### 活动会话指令

#### 模型看到的内容

只有请求带有 Agent 且存在活动指令时，`session:directives` 动态上下文才会渲染。System Prompt 服务会把这项贡献放入持久的聚合运行时上下文快照。

##### 渲染区段

```markdown
Session directives:
- [<scope>] <key> (source: <source>): <value>
```

#### Token 影响

完整贡献受 `maxTokens` 限制；被拒绝的写入不会改变模型上下文。替换会改变下一份运行时上下文快照，而不会累积指令条目。

#### KV Cache 影响

指令状态不变时会复用保留的运行时上下文快照。任何已接受的状态变更都会使下一次请求在可复用前缀之后追加替换快照。

## 已知限制与暂缓事项

- 本包有意不提供命令、模型工具、自动识别器、Web UI、压缩策略或 Bundle 接线。
- Token 限制使用确定性的字符密度估算，而不是提供商 tokenizer。
