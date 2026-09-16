# `@deepseek-ai/dsh-web-search-tavily`

[English](README.md) | 中文

面向提供方无关的 [`ctx.web`](../web) 服务的 Tavily 搜索提供方。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `apiKey` | 未设置 | 字面 API 密钥。优先使用凭据引用。 |
| `apiKeyEnv` | `TAVILY_API_KEY` | 每次搜索时解析的凭据引用。 |
| `baseURL` | `https://api.tavily.com` | API 基础 URL；提供方调用 `/search`。 |
| `searchDepth` | `basic` | Tavily 的 `basic` 或 `advanced` 搜索深度。 |
| `includeAnswer` | `true` | 请求 Tavily 生成综合答案。 |
| `maxResults` | 未设置 | 调用方未指定时使用的默认结果数。 |

提供方仅向配置的端点发送凭据并拒绝重定向。凭据可来自 `ctx.credentials` 或启动环境，并在每次操作时解析，因此轮换密钥无需重新挂载插件。

## 模型体验

- **提示词影响：** 无；[`dsh-tool-web`](../tool-web) 负责稳定的 `web_search` schema。
- **工具影响：** 当 `ctx.web` 选择 Tavily 时，它通过 `web_search` 提供标准化答案文本和可引用来源。
- **Token 影响：** 结果数量遵循共享 Web seam 的 `maxResults` 限制；Tavily 答案和摘要会占用模型上下文。
- **KV-cache 影响：** 除工具消费方正常记录的工具结果外没有额外影响。

## 已知限制与延后工作

Tavily 搜索不负责网页抓取。需要 `web_fetch` 时应另行挂载抓取提供方。
