/**
 * Screen watch plugin, browser half: one toggle in the composer tool row.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated remote namespaces (ctx.remote.commands).
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ScreenWatchToggle } from './ScreenWatchToggle.tsx'

/** Required services: the slot registry and the commands remote. */
export const inject = ['slots', 'remote', 'remote.commands']

type CommandsRemote = ClientContext['remote']['commands']

let commandsRemote: CommandsRemote | undefined

/** The page's commands remote, captured at apply time (module singleton per page). */
export function getCommandsRemote(): CommandsRemote | undefined {
  return commandsRemote
}

/** Register the screen watch toggle into the composer tool row. */
export function apply(ctx: ClientContext): void {
  commandsRemote = ctx.remote.commands
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'screen-watch',
    order: 40,
  }, ScreenWatchToggle))
}
