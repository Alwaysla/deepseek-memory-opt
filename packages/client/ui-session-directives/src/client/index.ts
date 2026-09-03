import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import './types.ts'
import { en, NS, zh } from './locales.ts'
import { SessionDirectivesView } from './SessionDirectivesView.tsx'

/** Command bridge injected into the directives view. */
export interface SessionDirectivesInjected {
  /** Execute one `/directive` operation; null means admitted success. */
  mutate: (operation: string) => Promise<string | null>
}

/** Required Client services. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/** Register the peer conversation view and command bridge. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-session-directives: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'directives', order: 20, locale: NS,
    label: () => t('view.label'),
    inject: (sessionId: SessionId): SessionDirectivesInjected => ({
      mutate: async (operation) => {
        const result = await ctx.remote.commands.execute(sessionId, `/directive ${operation}`, [])
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return 'unknown command: /directive'
        return result.value.result.kind === 'success' ? null : result.value.result.text
      },
    }),
  }, SessionDirectivesView))
}

export type { SessionDirectiveEntry, SessionDirectivesProjection } from './types.ts'
