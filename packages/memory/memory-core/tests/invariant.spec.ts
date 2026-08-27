/**
 * memory-core invariant coverage: the `memory/archived` field validator accepts
 * a well-formed record and rejects each malformed field, on both the load scan
 * and the live dispatch path.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as MemoryInvariant from '@deepseek-ai/dsh-memory-core/invariant'

function archived(data: unknown): SessionEvent {
  return { type: 'memory/archived', seq: 0, time: 0, data } as SessionEvent
}

function wellFormed(): Record<string, unknown> {
  return { entryId: 'abc', tags: ['auth'], digest: 'd', shadowedSeqs: [1], shadowedTokenCount: 2, summarySeq: 3 }
}

describe('memory/archived invariants', () => {
  it('accepts a well-formed record on the live dispatch path', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(MemoryInvariant)
    expect(() => { ctx.emit('session/event', {} as Session, archived(wellFormed())) }).not.toThrow()
  })

  it('validates a record already present in a loaded session', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('memory/archived', wellFormed() as never)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(MemoryInvariant).then(() => undefined)).resolves.toBeUndefined()
  })

  it.each([
    [{ ...wellFormed(), entryId: '' }, /entryId must be a non-empty string/],
    [{ ...wellFormed(), entryId: 42 }, /entryId must be a non-empty string/],
    [{ ...wellFormed(), tags: 'auth' }, /tags must be an array/],
    [{ ...wellFormed(), tags: [''] }, /tags must be an array/],
    [{ ...wellFormed(), shadowedSeqs: [] }, /at least one shadowed node/],
    [{ ...wellFormed(), shadowedSeqs: 'nope' }, /at least one shadowed node/],
    [{ ...wellFormed(), summarySeq: -1 }, /summarySeq must be a non-negative integer/],
    [{ ...wellFormed(), summarySeq: 1.5 }, /summarySeq must be a non-negative integer/],
  ])('rejects a malformed record', async (data, pattern) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(MemoryInvariant)
    expect(() => { ctx.emit('session/event', {} as Session, archived(data)) }).toThrow(pattern)
  })
})
