import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as DirectiveInvariant from '@deepseek-ai/dsh-session-directives/invariant'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'

const valid = {
  kind: 'directive/change' as const,
  version: 1 as const,
  directives: [{ key: 'tone', value: 'Be concise.', source: 'test', scope: 'session' as const }],
}

describe('session directive invariants', () => {
  it('rejects malformed durable changes before commit and remains reusable', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await ctx.plugin(DirectiveInvariant)
    const session = ctx.sessions.create()
    expect(() => session.append('directive/change', {
      ...valid,
      directives: [{ ...valid.directives[0], scope: 'global' }],
    } as never)).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT', packageName: '@deepseek-ai/dsh-session-directives',
    }))
    expect(session.seq).toBe(0)
    expect(() => session.append('directive/change', valid)).not.toThrow()
  })

  it('validates an existing durable stream when mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create()
    session.append('directive/change', valid)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(DirectiveInvariant)).resolves.toBeDefined()
  })
})
