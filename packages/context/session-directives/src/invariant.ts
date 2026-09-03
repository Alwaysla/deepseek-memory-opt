/** Package-owned durable session-directive invariants. @module @deepseek-ai/dsh-session-directives/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { decodeDirectiveChange } from './fold.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-session-directives'

/** Cordis companion plugin name. */
export const name = 'session-directives-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type !== 'directive/change') return
  try {
    if (decodeDirectiveChange(event.data) === undefined) throw new Error('payload kind is invalid')
  } catch (error) {
    fail(`session event ${event.seq} violates the durable directive stream: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Install strict payload validation for loaded and newly appended changes. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const seed = (session: Session): void => {
    for (const event of session.events) validateEvent(event, fail)
  }
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the directive-stream invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
