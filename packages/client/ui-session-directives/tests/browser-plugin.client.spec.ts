import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'

it('registers and disposes the directives conversation view', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({ name: 'root', children: { 'conversation.view': { kind: 'list', scope: 'session' } } } as never, () => null)
  const execute = vi.fn(() => Promise.resolve({ ok: true, value: { commandId: 'c', result: { kind: 'success' as const } } }))
  ctx.provide('remote', { commands: { execute } })
  ctx.provide('remote.commands', { execute })
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = ctx.slots.entries('conversation.view').find(candidate => candidate.options.id === 'directives')!
  const injected = (entry.inject as unknown as (id: SessionId) => { mutate(operation: string): Promise<string | null> })('s' as SessionId)
  await expect(injected.mutate('delete tone')).resolves.toBeNull()
  expect(execute).toHaveBeenCalledWith('s', '/directive delete tone', [])
  await fiber.dispose()
  expect(ctx.slots.entries('conversation.view').some(candidate => candidate.options.id === 'directives')).toBe(false)
})

describe('manifest', () => { it('declares bound services', () => expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])) })
