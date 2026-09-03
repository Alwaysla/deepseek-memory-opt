/** Package invariant companion for the session directives view. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-session-directives'

/** Cordis companion plugin name. */
export const name = 'client-ui-session-directives-invariant'
/** Required invariant registry. */
export const inject = ['invariants']

/** No runtime invariant: this pure Client consumer owns only a disposable view registration. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
