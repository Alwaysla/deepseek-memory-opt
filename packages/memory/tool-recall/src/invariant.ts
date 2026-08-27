/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tool-recall`.
 * @module @deepseek-ai/dsh-tool-recall/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-recall'

/** Cordis companion plugin name. */
export const name = 'tool-recall-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this read-only tool reconstructs archived spans from the
 * durable log and the `memoryIndex` projection. It owns no event or mutable-data
 * relationship beyond the tool registry that already validates registration.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
