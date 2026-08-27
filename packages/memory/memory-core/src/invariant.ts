/** Package-owned durable memory-archive record invariants. @module @deepseek-ai/dsh-memory-core/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-core'

/** Cordis companion plugin name. */
export const name = 'memory-core-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Validate one `memory/archived` record before it reaches the durable log. A
 * record must name a non-negative `summarySeq` and a non-empty `shadowedSeqs`
 * set, because recall reconstructs the span from those seqs — an empty set
 * would index a span with nothing to reconstruct.
 */
function validateArchived(data: SessionEvent<'memory/archived'>['data'], fail: InvariantFailure): void {
  if (typeof data.entryId !== 'string' || data.entryId.length === 0) {
    fail('memory/archived entryId must be a non-empty string')
  }
  if (!Array.isArray(data.tags) || data.tags.some(tag => typeof tag !== 'string' || tag.length === 0)) {
    fail('memory/archived tags must be an array of non-empty strings')
  }
  if (!Array.isArray(data.shadowedSeqs) || data.shadowedSeqs.length === 0) {
    fail('memory/archived shadowedSeqs must name at least one shadowed node')
  }
  if (!Number.isInteger(data.summarySeq) || data.summarySeq < 0) {
    fail('memory/archived summarySeq must be a non-negative integer')
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'memory/archived') validateArchived(event.data, fail)
}

/** Install validation for loaded and newly appended memory-archive records. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the memory-archive invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
