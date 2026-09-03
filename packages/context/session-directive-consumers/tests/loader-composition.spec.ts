import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionDirectives from '@deepseek-ai/dsh-session-directives'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as consumers from '@deepseek-ai/dsh-session-directive-consumers'
import * as directiveTools from '@deepseek-ai/dsh-session-directive-consumers/tools'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('session directive consumers real Loader composition', () => {
  it('loads the command and tools and mutates through the domain', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-directive-consumers-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-commands'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-session-directives'",
      "- name: '@deepseek-ai/dsh-session-directive-consumers'",
      "- name: '@deepseek-ai/dsh-session-directive-consumers/tools'",
      '',
    ].join('\n'))
    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-commands', CommandRuntime],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-session-directives', SessionDirectives],
      ['@deepseek-ai/dsh-session-directive-consumers', consumers],
      ['@deepseek-ai/dsh-session-directive-consumers/tools', directiveTools],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const session = Session.create(SessionId('loader-directive-consumers'))
    const agent = { id: session.id, session, status: 'idle', options: {}, ctx: new Context(), reserveTurnAdmission: () => () => undefined } as unknown as Agent
    context.agents.register(agent)
    const execution = await context.commands.execute(
      agent, '/directive set response.tone "Use plain language."', [], new AbortController().signal,
    )
    expect(execution?.result.kind).toBe('success')
    expect(context.sessionDirectives.list(session)).toEqual([{
      key: 'response.tone', value: 'Use plain language.', source: 'user', scope: 'session',
    }])
    expect(context.tools.get('list_directives')).toBeDefined()
    expect(context.tools.get('set_directive')).toBeDefined()
    expect(context.tools.get('remove_directive')).toBeDefined()
  })
})
