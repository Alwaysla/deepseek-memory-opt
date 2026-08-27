/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-memory-compaction`.
 * @module @deepseek-ai/dsh-memory-compaction/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-compaction'

/** Cordis companion plugin name. */
export const name = 'memory-compaction-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the only durable data this backend emits is the
 * `memory/archived` record, whose field validation is owned by the vocabulary
 * package `@deepseek-ai/dsh-memory-core`. Compaction lock and surface-replace
 * relationships are owned by `@deepseek-ai/dsh-compaction`.
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
