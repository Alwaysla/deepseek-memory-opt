import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { EntryId } from '@deepseek-ai/dsh-memory-core'
import * as MemoryCore from '@deepseek-ai/dsh-memory-core'
import * as MemoryCatalog from '@deepseek-ai/dsh-memory-catalog'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-memory-catalog-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-session-projection'",
    "- name: '@deepseek-ai/dsh-memory-core'",
    "- name: '@deepseek-ai/dsh-memory-catalog'",
    '  config:',
    '    maxEntries: 10',
    '    maxTokens: 200',
    '    digestMaxChars: 80',
    '',
  ].join('\n'))
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-memory-core', MemoryCore],
    ['@deepseek-ai/dsh-memory-catalog', MemoryCatalog],
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

describe('memory catalog through a real Loader composition', () => {
  it('renders the durable index into model-facing runtime context', async () => {
    const ctx = await boot()
    const session = Session.create(SessionId('memory-catalog-loader'))
    session.append('memory/archived', {
      entryId: EntryId('entry'), tags: ['sqlite'], digest: 'migration decision',
      shadowedSeqs: [0], shadowedTokenCount: 8, summarySeq: 10,
    })
    const assembly = await ctx.systemPrompt.assemble({ agent: { session } as never })
    expect(assembly.contexts).toEqual([{
      name: 'memory:catalog',
      text: expect.stringContaining('tags: sqlite — migration decision'),
    }])
  })
})
