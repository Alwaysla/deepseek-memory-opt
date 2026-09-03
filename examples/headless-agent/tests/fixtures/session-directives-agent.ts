/** Loader fixture that publishes the session-directives snapshot agent. @module session-directives-agent */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Fixture plugin name. */
export const name = 'session-directives-agent'
/** Services that must exist before the fixture resumes its agent. */
export const inject = ['agents', 'agentLoop', 'sessionDirectives', 'sessionPersistence']

/**
 * Resume the seeded directive session and bind its handle to this fixture's lifetime.
 * @param ctx - settled agent and persistence services from the Loader tree.
 * @returns after the resumed agent is published.
 */
export async function apply(ctx: Context): Promise<void> {
  const handle = await ctx.agents.resume({
    resumeSessionId: 'session-directives-prepopulated' as SessionId,
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  })
  ctx.sessionDirectives.set(handle.agent.session, {
    key: 'response.concise', value: 'Keep responses concise unless the user asks for detail.',
    source: 'user', scope: 'session',
  })
  ctx.effect(() => () => handle.dispose(), 'session-directives-agent.handle')
}
