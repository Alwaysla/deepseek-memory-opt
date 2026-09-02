# DeepSeek Harness 记忆优化版

[English](README.md) | 中文

在长任务的执行中，AI的上下文爆炸往往是最让人头疼的事情，不压缩？AI会变得越来越不知所云；压缩？又担心丢失关键信息AI可能又会一顿乱搞。于是我在思考一种适用于长任务的上下文保存逻辑：即当上下文用量大于设定阈值时将历史上下文分类打包、落盘，在上下文中换成一个标签，只记录他的索引。当当前任务需要用到这段上下文时再根据标签从日志中将它取出来，用完后再放回并打包新的上下文标签。以此实现记忆管理，让AI有想对更长更多的记忆，但又不至于上下文爆炸。

该实现得益于deepseek harness两个重要的插件：其一是subagent，将一些会脏上下文的任务交给subagent来办，主代理中只保存结论与关键信息；其二是基于compaction-basic插件，compaction-basic插件实现了一个简单的丢弃上下文功能，当当前上下文使用量大于设定阈值后，将一部分上下文折叠为一个名牌进行存放，然后缩简上下文大小。但该压缩只是在保留原本日志不变的情况下缩减了当前对话的上下文，并没有索引历史上下文的功能。我的实现即是增加了折叠时的分类、需要时回调及回调后新的归档功能。

> **说明**：本项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 扩展而来，所有改动遵循 MIT 许可证。
>
> **新增特性**：
> - **标签索引记忆系统**：长期记忆系统，支持按标签按需检索已归档的对话片段
>   - `memory-core`：基于内容哈希的归档事件和记忆投影
>   - `memory-compaction`：带标签的压缩后端，自动归档并索引片段
>   - `memory-catalog`：在每个相关模型请求中提供有界的近期标签与摘要目录
>   - `tool-recall`：`recall_memory(tags)` 工具，从持久化日志确定性重建片段
>   - `memory-ttl-pruner`：过期召回内容的自动折回
>
> 详见 [Agent Note：标签索引记忆](.agents/notes/implemented/feature/2026-08-26-tag-indexed-memory.zh.md)。

---

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

<a id="run"></a>

## 运行

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/Alwaysla/deepseek-memory-opt.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 会准备仓库产物。`pnpm dsh web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="https://cdn.deepseek.com/harness/readme/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="https://cdn.deepseek.com/harness/readme/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
