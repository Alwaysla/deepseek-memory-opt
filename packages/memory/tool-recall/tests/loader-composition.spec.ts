// Proves the memory feature works as a REAL cordis.yml composition booted
// through the Loader (not just hand-built ctx.plugin suites): memory-core's
// memoryIndex projection and tool-recall's recall_memory tool, wired together
// over a session, reconstruct an archived span by tag.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import * as MemoryCore from '@deepseek-ai/dsh-memory-core'
import { EntryId } from '@deepseek-ai/dsh-memory-core'
import * as ToolRecall from '@deepseek-ai/dsh-tool-recall'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function agent(ctx: Context): Agent {
  const scope = ctx.plugin(() => {})
  const id = SessionId('memory-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle', ctx: scope.ctx,
    followup: () => {}, steer: () => {}, inject: () => {}, send: () => {}, cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

/** Boot a cordis.yml composing the memory recall surface through the real Loader. */
async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-user-questions'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-memory-core'",
    "- name: '@deepseek-ai/dsh-tool-recall'",
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-user-questions', UserQuestionService],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-memory-core', MemoryCore],
    ['@deepseek-ai/dsh-tool-recall', ToolRecall],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

describe('memory recall through a real Loader composition', () => {
  it('reconstructs an archived span by tag from a cordis.yml-booted composition', async () => {
    const ctx = await boot()
    const subject = agent(ctx)
    // Seed a shadowed exchange and its memory/archived index record.
    const user = subject.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'set up the sqlite migration' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    subject.session.append('memory/archived', { entryId: EntryId('e1'), tags: ['sqlite', 'migration'], digest: 'db work', shadowedSeqs: [user.seq], shadowedTokenCount: 8, summarySeq: user.seq })

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('recall-loader-1'),
      name: 'recall_memory',
      arguments: { tags: ['sqlite'] },
      agent: subject,
    })

    expect(result.isError).toBeFalsy()
    expect(resultText(result)).toContain('set up the sqlite migration')
    expect(resultText(result)).toContain('recalled-memory')
  })
})
