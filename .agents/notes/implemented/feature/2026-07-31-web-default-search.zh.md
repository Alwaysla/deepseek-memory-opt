# Agent Note: 已交付组合中的默认 Web 搜索

Status: implemented

[English](2026-07-31-web-default-search.md) | 中文

## 问题

该 harness 已具备完整的 Web 能力体系：提供方注册表、多个搜索提供方、本地抓取、稳定的面向模型工具和结构化结果呈现。已交付组合需要显式选择一个搜索实现，使模型无需部署覆盖层即可发现最新信息。该实现必须使用共享凭据服务，以便运行时存储或轮换的密钥在下一次请求中生效。

## 决策

基础 bundle 挂载 `dsh-web` 并配置 `searchProvider: tavily`，同时挂载 `dsh-web-search-tavily`，使用 `TAVILY_API_KEY` 凭据引用。面向模型的 `dsh-tool-web` 配置行继续由 agent preset 所有；Host 组合负责共享服务和提供方注册表。显式提供方 id 使选择不受注册顺序影响，也允许个人覆盖层或 `--config` 覆盖层替换或禁用该提供方。

Tavily 在每次搜索时通过可选的 `ctx.credentials` 解析凭据，仅在未挂载凭据服务时回退到启动环境。程序化组合仍可提供非空 `apiKey` 字面值。凭据缺失时，操作以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败，稳定工具 schema 仍保持注册。提供方调用 Tavily 的 `POST /search`，默认请求生成综合答案，并将结果正文和发布日期映射为提供方无关结果；它在凭据可能被自动转发到其他端点前拒绝重定向。

默认挂载不启用 `web_fetch` 或本地抓取提供方。`web_search` 在 shell 和文件系统权限预设之外执行；需要限制网络的部署必须添加 `tools/pre-execute` 策略或按能力实施网络限制。

## 考虑过的替代方案

**仅挂载 `dsh-tool-web`。** 稳定 schema 如果没有已注册提供方，每次默认调用都会失败。已交付默认配置必须提供预期实现。

**在提供方加载时固定读取 `process.env.TAVILY_API_KEY`。** 凭据服务支持运行时存储和轮换；逐次解析可让下一次搜索无需重启即可使用新值。

**将 Web 工具保留在 Host bundle 中。** 工具属于单个 agent 会话，由已交付 preset 所有。Host bundle 只拥有共享服务和提供方。

**同时启用搜索和抓取。** 默认 `web_fetch` 会允许模型选择任意 URL 执行匿名出站 HTTP(S) 抓取。接受更广泛检索范围的部署可通过覆盖层挂载 `dsh-web-fetch-http` 并启用该工具。

## 后果

已交付会话公开稳定的 `web_search` 模型约定，Tavily 提供生成答案、摘要、来源 URL、标题以及可用的发布日期。搜索凭据无需重新挂载提供方即可轮换，重定向响应也无法自动转发 bearer token。完整页面抓取仍需显式启用。提供方测试覆盖映射、凭据失败、取消、请求字段、释放和重定向拒绝；浏览器场景使用本地 Tavily 兼容端点启动已交付组合，并固定持久化工具结果和卡片呈现。
