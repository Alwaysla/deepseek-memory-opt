/**
 * Screen watch host plugin: the `/screenwatch` command.
 *
 * `start` spawns (or reuses) one durable continuable child labeled
 * `screen-watch` under the invoking session. DeskDSH's browser page then feeds
 * periodic screenshots to that child through the existing `subagent.prompt`
 * RPC, so analysis accumulates in the child's own conversation and the main
 * conversation stays clean. The main agent reaches the same data through its
 * ordinary subagent tools (`list_agents` / `send_message`).
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the commands Context merge (ctx.commands).
import type {} from '@deepseek-ai/dsh-commands'
// Type-only: pulls the subagents Context merge (ctx.subagents).
import type {} from '@deepseek-ai/dsh-subagent'

export const inject = ['commands', 'subagents']

/** Durable creation label the browser side searches for in subagent.list. */
export const WATCHER_LABEL = 'screen-watch'

/** Seed prompt delivered as the watcher's first user message. */
const WATCHER_SEED = `你是「看屏记录员」（DeskDSH 屏幕看屏功能）。之后你会周期性收到一张屏幕截图和一条固定说明。

工作规则：
- 对每张截图，用一两句话极简记录屏幕显示的内容和正在进行的活动，附上收到时间。
- 绝不展开分析、不提问、不调用任何工具、不执行任何操作。
- 你的历史记录供主代理在用户询问屏幕情况时查询，记录要 factual、可追溯。`

/** Register the /screenwatch command. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.commands.register({
    name: 'screenwatch',
    description: '管理 DeskDSH 屏幕看屏子代理（start 启动或复用 / stop 停止定时截图）',
    handler: async (invocation) => {
      const input = (invocation.rawInput ?? '').trim()
      const action = input === '' ? 'start' : (input.split(/\s+/)[0] ?? 'start').toLowerCase()
      if (action === 'stop') {
        return {
          kind: 'success' as const,
          text: '看屏子代理已保留（历史记录仍可被主代理查询）；定时截图已停止。',
        }
      }
      if (action !== 'start') {
        return { kind: 'error' as const, text: `未知操作 "${action}"，支持 start / stop` }
      }
      const parentSessionId = invocation.agent.id
      const children = await ctx.subagents.listChildren(parentSessionId, invocation.signal)
      // listChildren orders by createdAt: the first match is the original.
      const watchers = children.filter(
        child => child.kind === 'child' && child.mode === 'continuable' && child.label === WATCHER_LABEL,
      )
      // Self-heal duplicates (e.g. double clicks, retried commands): keep
      // the oldest watcher, release the extras' live activations.
      const extras = watchers.length > 1 ? watchers.slice(1).map(child => child.id) : []
      if (extras.length > 0) {
        await ctx.subagents.drainContinuableChildren(invocation.agent, extras)
      }
      const existing = watchers[0]
      if (existing !== undefined && existing.kind === 'child' && existing.mode === 'continuable') {
        return {
          kind: 'success' as const,
          text: extras.length > 0
            ? `发现 ${watchers.length} 个看屏子代理，已保留最早的（${existing.id}），释放多余 ${extras.length} 个。`
            : `看屏子代理已存在（${existing.id}），继续使用。`,
        }
      }
      const started = await ctx.subagents.startContinuable({
        provider: 'spawn',
        label: WATCHER_LABEL,
        request: {
          parent: invocation.agent,
          prompt: [{ type: 'text', text: WATCHER_SEED }],
        },
        signal: invocation.signal,
      })
      return {
        kind: 'success' as const,
        text: `看屏子代理已启动：${started.childId}。此后定时截图将由它在后台记录。`,
      }
    },
  }), 'host-screen-watch: /screenwatch command')
}
