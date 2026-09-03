import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionDirectivesService, {
  applyDirectiveEvent,
  estimateDirectiveTokens,
  foldSessionDirectives,
  renderSessionDirectives,
  SessionDirectivesError,
} from '@deepseek-ai/dsh-session-directives'

async function setup(config: ConstructorParameters<typeof SessionDirectivesService>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SessionDirectivesService, config)
  return { ctx, session: ctx.sessions.create() }
}

const first = { key: 'tone', value: 'Be concise.', source: 'test', scope: 'session' as const }

describe('session directives', () => {
  it('folds complete changes last-wins and preserves unrelated-state identity', () => {
    const empty = { directives: [] }
    const unrelated = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as never
    expect(applyDirectiveEvent(empty, unrelated)).toBe(empty)
    const events = [
      { type: 'directive/change', seq: 0, time: 1, data: { kind: 'directive/change', version: 1, directives: [first] } },
      { type: 'directive/change', seq: 1, time: 2, data: { kind: 'directive/change', version: 1, directives: [] } },
    ] as never
    expect(foldSessionDirectives(events)).toEqual({ directives: [] })
  })

  it('lists, replaces stably, removes, clears, and projects whole state', async () => {
    const { ctx, session } = await setup()
    ctx.sessionDirectives.set(session, first)
    ctx.sessionDirectives.set(session, { key: 'format', value: 'Use Markdown.', source: 'test', scope: 'session' })
    ctx.sessionDirectives.set(session, { ...first, value: 'Be extremely concise.', source: 'replacement' })
    expect(ctx.sessionDirectives.list(session)).toEqual([
      { ...first, value: 'Be extremely concise.', source: 'replacement' },
      { key: 'format', value: 'Use Markdown.', source: 'test', scope: 'session' },
    ])
    expect(ctx.sessionProjections.snapshot(session).values.sessionDirectives).toEqual({
      directives: ctx.sessionDirectives.list(session),
    })
    expect(ctx.sessionDirectives.remove(session, 'tone')).toBe(true)
    expect(ctx.sessionDirectives.remove(session, 'missing')).toBe(false)
    expect(ctx.sessionDirectives.clear(session)).toBe(true)
    expect(ctx.sessionDirectives.clear(session)).toBe(false)
    expect(session.events.filter(event => event.type === 'directive/change').at(-1)?.data).toEqual({
      kind: 'directive/change', version: 1, directives: [],
    })
  })

  it('rejects complete-state entry, value, and rendered-token overflow without appending', async () => {
    const entries = await setup({ maxEntries: 1, maxTokens: 256, valueMaxChars: 200 })
    entries.ctx.sessionDirectives.set(entries.session, first)
    const beforeEntries = entries.session.seq
    expect(() => entries.ctx.sessionDirectives.set(entries.session, {
      key: 'second', value: 'x', source: 'test', scope: 'session',
    })).toThrow(expect.objectContaining<Partial<SessionDirectivesError>>({ code: 'SESSION_DIRECTIVES_TOO_MANY_ENTRIES' }))
    expect(entries.session.seq).toBe(beforeEntries)

    const chars = await setup({ maxEntries: 12, maxTokens: 256, valueMaxChars: 2 })
    expect(() => chars.ctx.sessionDirectives.set(chars.session, {
      key: 'unicode', value: '😀😀😀', source: 'test', scope: 'session',
    })).toThrow(expect.objectContaining<Partial<SessionDirectivesError>>({ code: 'SESSION_DIRECTIVES_VALUE_TOO_LONG' }))
    expect(chars.session.seq).toBe(0)

    const rendered = renderSessionDirectives([first])
    const exact = estimateDirectiveTokens(rendered)
    const tokens = await setup({ maxEntries: 12, maxTokens: exact - 1, valueMaxChars: 200 })
    expect(() => tokens.ctx.sessionDirectives.set(tokens.session, first)).toThrow(
      expect.objectContaining<Partial<SessionDirectivesError>>({ code: 'SESSION_DIRECTIVES_BUDGET_EXCEEDED' }),
    )
    expect(tokens.session.seq).toBe(0)
    const accepted = await setup({ maxEntries: 12, maxTokens: exact, valueMaxChars: 200 })
    expect(() => accepted.ctx.sessionDirectives.set(accepted.session, first)).not.toThrow()
  })

  it('rejects replayed state that exceeds the active deployment limits', async () => {
    const { ctx, session } = await setup({ maxEntries: 1, maxTokens: 256, valueMaxChars: 2 })
    session.append('directive/change', {
      kind: 'directive/change', version: 1, directives: [{ ...first, value: 'oversized' }],
    })
    expect(() => ctx.sessionDirectives.list(session)).toThrow(
      expect.objectContaining<Partial<SessionDirectivesError>>({ code: 'SESSION_DIRECTIVES_VALUE_TOO_LONG' }),
    )
    await expect(ctx.systemPrompt.assemble({ agent: { session } as never })).rejects.toMatchObject({
      code: 'SESSION_DIRECTIVES_VALUE_TOO_LONG',
    })
  })

  it('registers the bounded session:directives runtime context', async () => {
    const { ctx, session } = await setup()
    ctx.sessionDirectives.set(session, first)
    const assembly = await ctx.systemPrompt.assemble({ agent: { session } as never })
    expect(assembly.contexts).toContainEqual({
      name: 'session:directives',
      text: renderSessionDirectives([first]),
    })
    const diagnostic = await ctx.systemPrompt.assemble()
    expect(diagnostic.contexts).toContainEqual({ name: 'session:directives', text: '' })
  })

  it('rejects malformed durable scope and duplicate stable keys', () => {
    const duplicate = { kind: 'directive/change', version: 1, directives: [first, first] }
    expect(() => foldSessionDirectives([
      { type: 'directive/change', seq: 0, time: 1, data: duplicate },
    ] as never)).toThrow(/duplicated/)
    expect(() => foldSessionDirectives([
      { type: 'directive/change', seq: 0, time: 1, data: {
        kind: 'directive/change', version: 1, directives: [{ ...first, scope: 'global' }],
      } },
    ] as never)).toThrow(/scope/)
  })
})
