/** Package-owned invariant companion for `@deepseek-ai/dsh-memory-catalog`. @module @deepseek-ai/dsh-memory-catalog/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-catalog'

/** Cordis companion plugin name. */
export const name = 'memory-catalog-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: publications are ordinary logged `user/message` events;
 * the memory-owned source kind and archive projection are pure typed functions.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
