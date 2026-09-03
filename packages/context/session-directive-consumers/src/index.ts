/**
 * Human command and conservative recognition for durable session directives.
 * @module @deepseek-ai/dsh-session-directive-consumers
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionDirectivesError } from '@deepseek-ai/dsh-session-directives'
import type {} from '@deepseek-ai/dsh-user-questions'

export const name = 'session-directive-consumers'
export const inject = ['agents', 'commands', 'sessionDirectives']

/** Stable key used for an automatically recognized concise-response preference. */
export const CONCISE_RESPONSE_DIRECTIVE_KEY = 'response.concise'

const CONCISE_RESPONSE_DIRECTIVE = 'Keep responses concise unless the user asks for detail.'
const USAGE = 'Usage: /directive [list|set <key> <JSON-string value>|delete <key>|clear]'
const KEY = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u

/** Conservative classification of concise-response wording. */
export type DirectiveRecognition =
  | { readonly kind: 'none' }
  | { readonly kind: 'one-turn'; readonly key: typeof CONCISE_RESPONSE_DIRECTIVE_KEY }
  | { readonly kind: 'persistent'; readonly key: typeof CONCISE_RESPONSE_DIRECTIVE_KEY; readonly value: string }
  | { readonly kind: 'confirmation'; readonly key: typeof CONCISE_RESPONSE_DIRECTIVE_KEY; readonly value: string }

function messageText(content: readonly { readonly type: string; readonly text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && block.text !== undefined ? [block.text] : []).join('\n').trim()
}

/**
 * Recognize only the supported concise-response preference.
 * @param text - current direct-human message text.
 * @returns a persistence decision; one-turn and ambiguous wording never authorize mutation.
 */
export function recognizeDirective(text: string): DirectiveRecognition {
  const concise = /\b(?:concise|brief|short)\b/iu.test(text)
    || /(?:简洁|简短|精简|言简意赅)/u.test(text)
  if (!concise) return { kind: 'none' }
  const negatedConcise = /\b(?:do not|don't|never|avoid|stop)\b[^.!?。！？]{0,40}\b(?:concise|brief|short)\b/iu.test(text)
    || /(?:不要|别|避免|停止)[^。！？]{0,20}(?:简洁|简短|精简|言简意赅)/u.test(text)
  if (negatedConcise) return { kind: 'none' }
  if (/(?:\b(?:for this response|in this response|this time)\b|(?:这次|本次|本回答|本次回复))/iu.test(text)) {
    return { kind: 'one-turn', key: CONCISE_RESPONSE_DIRECTIVE_KEY }
  }
  const persistent = /\b(?:always|from now on|in (?:all )?future responses?|for future responses?|going forward)\b/iu.test(text)
    || /(?:以后|今后|之后的(?:回答|回复)|接下来一直|在这个会话中|始终|一直)/u.test(text)
  if (persistent) {
    return { kind: 'persistent', key: CONCISE_RESPONSE_DIRECTIVE_KEY, value: CONCISE_RESPONSE_DIRECTIVE }
  }
  const preference = /(?:\b(?:prefer|preference|please|keep|be)\b|(?:希望|偏好|请))/iu.test(text)
  return preference
    ? { kind: 'confirmation', key: CONCISE_RESPONSE_DIRECTIVE_KEY, value: CONCISE_RESPONSE_DIRECTIVE }
    : { kind: 'none' }
}

function validKey(key: string): boolean {
  return KEY.test(key)
}

function parseSet(input: string): { key: string; value: string } | undefined {
  const match = /^(\S+)\s+([\s\S]+)$/u.exec(input.trim())
  if (match === null) return undefined
  const key = match[1]
  if (key === undefined || !validKey(key)) return undefined
  try {
    const value: unknown = JSON.parse(match[2] ?? '')
    return typeof value === 'string' ? { key, value } : undefined
  } catch {
    return undefined
  }
}

function executeCommand(ctx: Context, invocation: CommandInvocation): CommandResult {
  const input = invocation.rawInput.trim()
  if (invocation.attachments.length > 0) {
    return { kind: 'error', text: 'Image attachments cannot accompany /directive.' }
  }
  if (input === '' || input === 'list') {
    return { kind: 'success', text: JSON.stringify({ directives: ctx.sessionDirectives.list(invocation.agent.session) }, null, 2) }
  }
  try {
    if (input === 'clear') {
      const changed = ctx.sessionDirectives.clear(invocation.agent.session)
      return { kind: 'success', text: changed ? 'All session directives cleared.' : 'No session directives to clear.' }
    }
    const deletion = /^delete\s+(\S+)$/u.exec(input)
    if (deletion !== null) {
      const key = deletion[1]
      if (key === undefined || !validKey(key)) return { kind: 'error', text: USAGE }
      const changed = ctx.sessionDirectives.remove(invocation.agent.session, key)
      return { kind: 'success', text: changed ? `Directive ${key} deleted.` : `Directive ${key} was not set.` }
    }
    if (input.startsWith('set ')) {
      const parsed = parseSet(input.slice(4))
      if (parsed === undefined) return { kind: 'error', text: `${USAGE}\nThe set value must be a JSON string.` }
      const directive = ctx.sessionDirectives.set(invocation.agent.session, {
        ...parsed,
        source: 'user',
        scope: 'session',
      })
      return { kind: 'success', text: JSON.stringify(directive) }
    }
    return { kind: 'error', text: USAGE }
  } catch (error: unknown) {
    if (error instanceof SessionDirectivesError) return { kind: 'error', text: error.message }
    throw error
  }
}

async function confirmRecognition(ctx: Context, agent: Agent, signal: AbortSignal): Promise<boolean | undefined> {
  const questions = ctx.get('userQuestions')
  if (questions === undefined) return undefined
  const yes = 'Save for this session'
  const no = 'Do not save'
  let answer
  try {
    answer = await questions.ask({
      agent,
      signal,
      questions: [{
        id: 'persist-concise-response',
        header: 'Session preference',
        question: 'Save concise responses as a persistent directive for this session?',
        options: [{ label: yes }, { label: no }],
      }],
    })
  } catch (error: unknown) {
    if (error instanceof HarnessError && error.code === 'NO_PROVIDER') return undefined
    throw error
  }
  const item = answer.answers.find(candidate => candidate.id === 'persist-concise-response')
  return item?.selected.length === 1 ? item.selected[0] === yes : false
}

function recognitionNotice(): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{
      type: 'text',
      text: 'A possible concise-response preference was recognized but not persisted because the wording did not explicitly make it a future preference and no confirmation channel was available. Ask whether to save it for this session.',
    }],
    source: { kind: 'plugin', plugin: name, form: 'notice', summary: 'Possible session preference not persisted' },
  })
}

/** Register the explicit command and conservative direct-human recognizer. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'directive',
    description: 'List or change persistent session directives',
    input: { hint: '[list|set <key> <JSON-string value>|delete <key>|clear]' },
    handler: invocation => executeCommand(ctx, invocation),
  })

  ctx.on('agent/pre-step', async ({ agent, messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || !ctx.agents.roots().includes(agent)) return decision
    const direct = messages.filter(message => message.source.kind === 'user')
    if (direct.length !== 1) return decision
    const recognition = recognizeDirective(messageText(direct[0]?.content ?? []))
    if (recognition.kind === 'persistent') {
      ctx.sessionDirectives.set(agent.session, {
        key: recognition.key, value: recognition.value, source: 'automatic', scope: 'session',
      })
      return decision
    }
    if (recognition.kind !== 'confirmation') return decision
    const confirmed = await confirmRecognition(ctx, agent, signal)
    if (confirmed === true) {
      ctx.sessionDirectives.set(agent.session, {
        key: recognition.key, value: recognition.value, source: 'automatic-confirmed', scope: 'session',
      })
      return decision
    }
    return confirmed === undefined
      ? { kind: 'enter', messages: [...decision.messages, recognitionNotice()] }
      : decision
  })
}
