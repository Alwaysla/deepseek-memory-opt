/**
 * memory-ttl-pruner coverage: a real agent loop exercises the agent/pre-step
 * fold of an aged recall_memory result, and direct pruneSession calls cover the
 * step-age gate, the recall-vs-other identification, and the empty case.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, CallId, createUserMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { Agent } from '@deepseek-ai/dsh-agent'
import MemoryTtlPruner from '@deepseek-ai/dsh-memory-ttl-pruner'

const MODEL = 'mock'
const RECALL = CallId('recall-1')

/** A model that emits one recall_memory tool call on the first step, then plain text. */
class RecallThenText extends LlmAdapter {
  private calls = 0
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100_000 } })
  }

  override async * stream(): AsyncIterable<StreamChunk> {
    this.calls += 1
    if (this.calls === 1) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: RECALL, name: 'recall_memory', arguments: '{"tags":["auth"]}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

let counter = 0

async function loopHarness(retainSteps: number): Promise<{ agent: Agent; ctx: Context; pruner: MemoryTtlPruner }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  ctx.llm.registerAdapter([MODEL], new RecallThenText())
  const pruner = new MemoryTtlPruner(ctx, { retainSteps })
  ctx.tools.register({
    name: 'recall_memory',
    description: 'recall',
    parameters: { type: 'object', additionalProperties: false, properties: { tags: { type: 'array', items: { type: 'string' } } } },
    output: { schema: { type: 'string' }, render: (_a: unknown, v: unknown) => [{ type: 'text', text: String(v) }] },
    execute: () => Promise.resolve('RECALLED SPAN CONTENT'),
  } as never)
  return { agent: ctx.agentLoop.create(SessionId(`ttl-${counter++}`), { provider: MODEL, model: MODEL }), ctx, pruner }
}

/** Text of the recall_memory tool result on the current surface, if present. */
function recallResultText(session: Session): string | undefined {
  for (const seq of [...session.surface.nodes].reverse()) {
    const event = session.events[seq]
    if (event?.type === 'tool/result' && event.data.message.source.callId === RECALL) {
      return event.data.message.content[0].content.filter((b): b is { type: 'text'; text: string } => b.type === 'text').map(b => b.text).join('')
    }
  }
  return undefined
}

/** A pruner instance over a bare session store, for direct pruneSession calls. */
async function directPruner(retainSteps?: number): Promise<{ ctx: Context; pruner: MemoryTtlPruner }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(TokenMeter)
  const pruner = new MemoryTtlPruner(ctx, retainSteps === undefined ? {} : { retainSteps })
  return { ctx, pruner }
}

/** Append a recall_memory tool/call (log-only) and one tool/result on the surface. */
function addRecall(session: Session, callId: CallId, name = 'recall_memory'): void {
  session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({ callId, content: [{ type: 'text', text: `span for ${callId}` }], isError: false }),
  }, { surfaceOp: 'append' })
}

describe('memory TTL pruner (agent/pre-step)', () => {
  it('folds an aged recall result back to a stub and prices it', async () => {
    const { agent } = await loopHarness(0)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(recallResultText(agent.session)).toContain('folded back')
    expect(agent.session.events.some(event => event.type === 'compaction/prune')).toBe(true)
  })

  it('keeps a recall result that has not aged past retainSteps', async () => {
    const { agent } = await loopHarness(5)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(recallResultText(agent.session)).toContain('RECALLED SPAN CONTENT')
  })

  it.each([
    ['an Error', new Error('boom'), /boom/],
    ['a non-Error', 'boom-string', /boom-string/],
  ])('warns and continues the turn when pruning throws %s', async (_label, thrown, pattern) => {
    const { agent, ctx, pruner } = await loopHarness(0)
    const warnings: string[] = []
    ctx.logger.warn = ((message: string) => { warnings.push(message) }) as never
    pruner.pruneSession = () => { throw thrown }
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(warnings.some(message => pattern.test(message))).toBe(true)
  })
})

describe('MemoryTtlPruner.pruneSession', () => {
  it('defaults retainSteps to 2 when unset', async () => {
    const { pruner } = await directPruner()
    expect(pruner.retainSteps).toBe(2)
  })

  it('folds only aged recall results, never other tool results', async () => {
    const { ctx, pruner } = await directPruner(0)
    const session = ctx.sessions.create()
    addRecall(session, RECALL)
    addRecall(session, CallId('other-1'), 'some_other_tool')
    session.append('step/start', { turn: 1, step: 2 })

    expect(pruner.pruneSession(session)).toBe(1)
    expect(recallResultText(session)).toContain('folded back')
    // The non-recall result is untouched.
    const other = [...session.surface.nodes].map(seq => session.events[seq]).find(e => e?.type === 'tool/result' && e.data.message.source.callId === CallId('other-1'))
    expect(other?.type === 'tool/result' && other.data.message.content[0].content[0]).toMatchObject({ text: 'span for other-1' })
  })

  it('keeps a recall result that has not aged past retainSteps', async () => {
    const { ctx, pruner } = await directPruner(5)
    const session = ctx.sessions.create()
    addRecall(session, RECALL)
    session.append('step/start', { turn: 1, step: 2 })
    expect(pruner.pruneSession(session)).toBe(0)
  })

  it('folds nothing when the session has no recall results', async () => {
    const { ctx, pruner } = await directPruner(0)
    const session = ctx.sessions.create()
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(pruner.pruneSession(session)).toBe(0)
  })
})
