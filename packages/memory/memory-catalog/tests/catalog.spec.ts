import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { EntryId } from '@deepseek-ai/dsh-memory-core'
import * as MemoryCore from '@deepseek-ai/dsh-memory-core'
import * as MemoryCatalog from '../src/index.ts'

async function setup(config: MemoryCatalog.Config = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(MemoryCore)
  await ctx.plugin(MemoryCatalog, config)
  const session = Session.create(SessionId('catalog-test'))
  const agent = { session } as never
  return { ctx, session, agent }
}

describe('memory catalog', () => {
  it('renders recent tags and bounded digests without archive metadata', async () => {
    const { ctx, session, agent } = await setup({ maxEntries: 1, maxTokens: 200, digestMaxChars: 8 })
    session.append('memory/archived', {
      entryId: EntryId('older-secret-id'), tags: ['old'], digest: 'older digest', shadowedSeqs: [1], shadowedTokenCount: 4, summarySeq: 10,
    })
    session.append('memory/archived', {
      entryId: EntryId('newer-secret-id'), tags: ['new'], digest: 'longer digest', shadowedSeqs: [2], shadowedTokenCount: 5, summarySeq: 20,
    })

    const assembly = await ctx.systemPrompt.assemble({ agent })
    expect(assembly.contexts).toEqual([{
      name: 'memory:catalog',
      text: [
        'Archived memories available through `recall_memory`:',
        '- tags: new — longer …',
        'Use `recall_memory` with one or more listed tags only when earlier detail is needed.',
      ].join('\n'),
    }])
    expect(assembly.contexts[0]?.text).not.toContain('secret-id')
    expect(assembly.contexts[0]?.text).not.toContain('shadowed')
    await ctx.fiber.dispose()
  })

  it('applies exact complete-output bounds and isolates agent sessions', async () => {
    const { ctx, session, agent } = await setup({ maxEntries: 2, maxTokens: 40, digestMaxChars: 4 })
    session.append('memory/archived', {
      entryId: EntryId('b'), tags: ['second'], digest: '😀😀😀😀😀', shadowedSeqs: [1], shadowedTokenCount: 1, summarySeq: 1,
    })
    session.append('memory/archived', {
      entryId: EntryId('a'), tags: ['first'], digest: 'line\nbreak', shadowedSeqs: [2], shadowedTokenCount: 1, summarySeq: 1,
    })
    const text = (await ctx.systemPrompt.assemble({ agent })).contexts[0]!.text
    expect(Math.ceil(text.length / 4)).toBe(40)
    expect(text).toContain('tags: first — lin…')
    expect(text).not.toContain('tags: second')

    const other = { session: Session.create(SessionId('other-catalog-test')) } as never
    expect((await ctx.systemPrompt.assemble({ agent: other })).contexts[0]?.text).toBe('')
    await ctx.fiber.dispose()
  })

  it('contributes nothing for an empty index and unregisters on disposal', async () => {
    const { ctx, agent } = await setup()
    const systemPrompt = ctx.systemPrompt
    expect((await systemPrompt.assemble({ agent })).contexts).toEqual([{ name: 'memory:catalog', text: '' }])
    await ctx.fiber.dispose()
    expect((await systemPrompt.assemble({ agent })).contexts).toEqual([])
  })
})
