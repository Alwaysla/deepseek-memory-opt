/**
 * memory-core unit coverage: the content-hash `entryIdFor`/`EntryId` identity,
 * the `RECALL_TOOL_NAME` protocol constant, and the `memoryIndex` projection —
 * its last-wins fold, same-reference gate for unrelated events, and HMR disposal.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as MemoryCore from '@deepseek-ai/dsh-memory-core'
import { EntryId, entryIdFor, RECALL_TOOL_NAME } from '@deepseek-ai/dsh-memory-core'
import type { MemoryEntry } from '@deepseek-ai/dsh-memory-core/types'

function message(text: string, id = 'fixed-id'): Message {
  return { ...createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), id } as Message
}

function entry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    entryId: EntryId('abc'),
    tags: ['auth'],
    digest: 'did the auth work',
    shadowedSeqs: [1, 2],
    shadowedTokenCount: 42,
    summarySeq: 3,
    ...overrides,
  }
}

async function harness(): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  const session = ctx.sessions.create()
  return { ctx, session }
}

describe('entryIdFor / EntryId', () => {
  it('brands a hex string unchanged', () => {
    expect(EntryId('deadbeef')).toBe('deadbeef')
  })

  it('is a stable sha-256 hex of the messages', () => {
    const id = entryIdFor([message('hello')])
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(entryIdFor([message('hello')])).toBe(id)
  })

  it('ignores message ids so a recalled-and-rearchived span hashes equal', () => {
    expect(entryIdFor([message('same', 'id-one')])).toBe(entryIdFor([message('same', 'id-two')]))
  })

  it('changes when the content changes', () => {
    expect(entryIdFor([message('a')])).not.toBe(entryIdFor([message('b')]))
  })
})

describe('RECALL_TOOL_NAME', () => {
  it('is the model-facing recall tool name', () => {
    expect(RECALL_TOOL_NAME).toBe('recall_memory')
  })
})

describe('memoryIndex projection', () => {
  it('is absent until memory-core is composed, then folds records last-wins by id', async () => {
    const { ctx, session } = await harness()
    expect(ctx.sessionProjections.stateOf(session, 'memoryIndex')).toBeUndefined()

    const fiber = await ctx.plugin(MemoryCore)
    expect(ctx.sessionProjections.stateOf(session, 'memoryIndex')).toEqual({ entries: {} })

    session.append('memory/archived', entry({ entryId: EntryId('one'), digest: 'first' }))
    session.append('memory/archived', entry({ entryId: EntryId('two'), tags: ['db'] }))
    session.append('memory/archived', entry({ entryId: EntryId('one'), digest: 'rewritten' }))

    const state = ctx.sessionProjections.stateOf(session, 'memoryIndex')
    expect(Object.keys(state?.entries ?? {})).toEqual(['one', 'two'])
    expect(state?.entries.one?.digest).toBe('rewritten')

    await fiber.dispose()
    expect(ctx.sessionProjections.stateOf(session, 'memoryIndex')).toBeUndefined()
  })

  it('returns the same state reference for an unrelated event', async () => {
    const { ctx, session } = await harness()
    await ctx.plugin(MemoryCore)
    session.append('memory/archived', entry())
    const before = ctx.sessionProjections.stateOf(session, 'memoryIndex')
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    expect(ctx.sessionProjections.stateOf(session, 'memoryIndex')).toBe(before)
  })

  it('serves the whole index as the client-visible wire view', async () => {
    const { ctx, session } = await harness()
    await ctx.plugin(MemoryCore)
    session.append('memory/archived', entry({ entryId: EntryId('one') }))
    const snapshot = ctx.sessionProjections.snapshot(session)
    expect(snapshot.values.memoryIndex).toEqual({ entries: { one: entry({ entryId: EntryId('one') }) } })
  })
})

describe('package namespace', () => {
  it('exports the plugin apply and name', () => {
    expect(MemoryCore.name).toBe('memory-core')
    expect(typeof MemoryCore.apply).toBe('function')
  })
})
