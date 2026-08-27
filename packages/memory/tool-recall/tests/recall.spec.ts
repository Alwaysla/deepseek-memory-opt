/**
 * recall_memory integration: the tool reconstructs archived spans from the
 * durable log at each entry's shadowed seqs and returns them by tag. Driven
 * through the real tool registry (ctx.tools.execute), a session store, the
 * projection registry, and the memory-core index, so the projection read, the
 * log reconstruction, and the model-facing render all run unmodified.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as MemoryCore from '@deepseek-ai/dsh-memory-core'
import { EntryId } from '@deepseek-ai/dsh-memory-core'
import * as ToolRecall from '@deepseek-ai/dsh-tool-recall'

let callCounter = 0

interface Bench {
  ctx: Context
  session: Session
  agent: Agent
  recall(tags: string[], withAgent?: boolean): Promise<ToolExecutionResult>
}

async function bench(withProjections = true): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  if (withProjections) {
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(MemoryCore)
  }
  await ctx.plugin(ToolRecall)
  const session = ctx.sessions.create()
  const agent = { id: session.id, session, status: 'idle', ctx } as Agent
  ctx.agents.register(agent)
  return {
    ctx,
    session,
    agent,
    recall(tags, withAgent = true) {
      return ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId(`call-${++callCounter}`),
        name: 'recall_memory',
        arguments: { tags },
        ...(withAgent ? { agent } : {}),
      })
    },
  }
}

function text(result: ToolExecutionResult): string {
  return result.content.filter((block): block is { type: 'text'; text: string } => block.type === 'text').map(block => block.text).join('')
}

/** Seed a user exchange and an archived entry that shadows it. */
function seedArchive(session: Session, tags: string[], entryId = 'e1'): void {
  const user = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'how does auth work' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  session.append('memory/archived', { entryId: EntryId(entryId), tags, digest: 'auth digest', shadowedSeqs: [user.seq], shadowedTokenCount: 10, summarySeq: user.seq })
}

describe('recall_memory', () => {
  it('registers a recall_memory tool taking a tags array', async () => {
    const b = await bench()
    const schema = b.ctx.tools.schemas().find(s => s.name === 'recall_memory')
    expect(schema).toBeDefined()
    expect(Object.keys((schema!.parameters as { properties: Record<string, unknown> }).properties)).toEqual(['tags'])
  })

  it('reconstructs archived spans whose tags match, from the durable log', async () => {
    const b = await bench()
    seedArchive(b.session, ['auth', 'login'])
    const result = await b.recall(['auth'])
    expect(result.isError).toBeFalsy()
    expect(text(result)).toContain('how does auth work')
    expect(text(result)).toContain('## user')
    expect(text(result)).toContain('recalled-memory')
  })

  it('matches case-insensitively and returns nothing for an unknown tag', async () => {
    const b = await bench()
    seedArchive(b.session, ['auth'])
    expect(text(await b.recall(['AUTH']))).toContain('how does auth work')
    expect(text(await b.recall(['unrelated']))).toContain('No archived memory')
  })

  it('returns no memories when the projection seam is not composed', async () => {
    const b = await bench(false)
    seedArchive(b.session, ['auth'])
    expect(text(await b.recall(['auth']))).toContain('No archived memory')
  })

  it('errors on a call with no owning agent session', async () => {
    const b = await bench()
    const result = await b.recall(['auth'], false)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires an agent session')
  })

  it('skips shadowed seqs that are missing or carry no model message', async () => {
    const b = await bench()
    const user = b.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'real message' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    const boundary = b.session.append('turn/start', { turn: 1 })
    // shadowedSeqs mix a real message, a log-only boundary (derives to null), and an out-of-range seq.
    b.session.append('memory/archived', { entryId: EntryId('mixed'), tags: ['auth'], digest: 'd', shadowedSeqs: [user.seq, boundary.seq, 9999], shadowedTokenCount: 5, summarySeq: user.seq })
    const result = await b.recall(['auth'])
    expect(text(result)).toContain('real message')
    expect(text(result)).not.toContain('turn/start')
  })

  it('has the namespace-plugin export shape (no stray default)', () => {
    expect('default' in ToolRecall).toBe(false)
    expect(ToolRecall.name).toBe('tool-recall')
    expect(ToolRecall.inject).toEqual(['tools'])
  })
})
