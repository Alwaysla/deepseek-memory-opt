/** Execution-time authority checks for model-facing directive mutations. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

type TurnStartEvent = Extract<SessionEvent, { type: 'turn/start' }>

/** Authenticated model tool execution in one open turn. */
export interface DirectiveToolExecution {
  readonly agent: Agent
  readonly start: TurnStartEvent
  readonly events: readonly SessionEvent[]
}

function reject(message: string, code = 'DIRECTIVE_TOOL_AUTHORITY_REQUIRED'): never {
  throw new HarnessError(message, code)
}

function openTurn(agent: Agent): { start: TurnStartEvent; events: readonly SessionEvent[] } {
  const events = agent.session.events
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const boundary = events[index]
    if (boundary?.type === 'turn/end') {
      return reject('directive tools require an open model turn', 'DIRECTIVE_TOOL_DRIVER_REQUIRED')
    }
    if (boundary?.type === 'turn/start') {
      return { start: boundary, events: events.slice(index + 1) }
    }
  }
  return reject('directive tools require an open model turn', 'DIRECTIVE_TOOL_DRIVER_REQUIRED')
}

/**
 * Resolve the exact live calling agent inside its active driver.
 * @param ctx - Context carrying the live agent registry.
 * @param exec - Tool execution metadata supplied by the registry.
 * @returns the authenticated agent and current turn window.
 */
export function directiveToolExecution(ctx: Context, exec: ToolRunContext): DirectiveToolExecution {
  const agent = exec.agent
  if (agent === undefined) {
    return reject('directive tools require a calling agent', 'DIRECTIVE_TOOL_AGENT_REQUIRED')
  }
  if (ctx.agents.get(agent.id) !== agent || agent.status !== 'running'
    || ctx.agents.currentInitiator() !== agent) {
    return reject(
      'directive tools require the exact live calling agent inside its active driver',
      'DIRECTIVE_TOOL_DRIVER_REQUIRED',
    )
  }
  return { agent, ...openTurn(agent) }
}

/**
 * Require a host-attested human message in the current runtime-root turn.
 * @param ctx - Context carrying the live agent graph.
 * @param execution - authenticated current tool execution.
 * @param operation - mutation class whose matching direct-human intent is required.
 */
export function requireDirectiveMutationAuthority(
  ctx: Context,
  execution: DirectiveToolExecution,
  operation: 'set' | 'remove',
): void {
  const directHumanText = ctx.agents.roots().includes(execution.agent)
    ? execution.events.flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : []).join('\n')
    : ''
  const oneTurnPattern = /\b(?:for this response|in this response|this time)\b|(?:这次|本次|本回答|本次回复)/iu
  const persistentPattern = new RegExp(
    String.raw`\b(?:always|from now on|in (?:all )?future responses?|for future responses?|going forward|remember|persist|save (?:this|that))\b`
      + String.raw`|(?:以后|今后|之后都|之后的(?:回答|回复)|接下来一直|在这个会话中|始终|一直|记住|持续|保存)`,
    'iu',
  )
  const removalPattern = /\b(?:remove|delete|clear|forget|stop remembering)\b|(?:删除|移除|清除|忘掉|不要再记住)/iu
  const oneTurn = oneTurnPattern.test(directHumanText)
  const persistent = persistentPattern.test(directHumanText)
  const removal = removalPattern.test(directHumanText)
  if (!oneTurn && (operation === 'set' ? persistent : removal)) return
  reject(`directive ${operation} requires an explicit persistent request in the current direct human message`)
}
