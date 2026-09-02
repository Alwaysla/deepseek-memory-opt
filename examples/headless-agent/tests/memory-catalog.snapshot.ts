import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { normalizeSessionSnapshot, type NormalizeContext } from '@deepseek-ai/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { EntryId } from '@deepseek-ai/dsh-memory-core'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'memory-catalog-snapshots/prepopulated')
const replayFixture = join(fixtureDir, 'replay.jsonl')
const replayOverride = join(fixtureDir, 'replay.override.json')
const sessionExpected = join(fixtureDir, 'session.expected.jsonl')
const configPath = fileURLToPath(new URL('../memory-catalog.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const sessionId = SessionId('memory-catalog-prepopulated')
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'
const task = 'Confirm whether relevant archived memory is available.'

async function seedMemorySession(root: string, cwd: string): Promise<string> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const meta: SessionHeader = {
    version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, cwd, delegationDepth: 0,
  }
  const events: SessionEvent[] = [{
    type: 'memory/archived', seq: 0, time: 10,
    data: {
      entryId: EntryId('catalog-entry'), tags: ['sqlite', 'migration'],
      digest: 'database migration decision', shadowedSeqs: [0],
      shadowedTokenCount: 8, summarySeq: 10,
    },
  }]
  try {
    await ctx.sessionPersistence.create(meta)
    await ctx.sessionPersistence.append(sessionId, events)
    const location = ctx.sessionPersistence.locate(meta)
    if (location === undefined) throw new Error('JSONL backend did not locate the seeded session')
    return location.path
  } finally {
    await ctx.fiber.dispose()
  }
}

describe('memory catalog snapshot', () => {
  it('publishes a bounded archived-memory catalog through the headless app', async () => {
    let cwd = ''
    let sessionPath = ''
    const result = await runLoaderSmoke({
      label: 'memory catalog headless snapshot', tempDirPrefix: 'dsh-memory-catalog-snapshot-',
      binScript, libBinScript: binScript, configPath, binArgs: [configPath, task], tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayFixture, DSH_SNAPSHOT_OVERRIDE: replayOverride },
      prepare: async (runCwd) => {
        cwd = runCwd
        sessionPath = await seedMemorySession(join(runCwd, '.sessions'), runCwd)
      },
      inspect: async () => {
        const normalization: NormalizeContext = { sessionIds: [sessionId], cwd }
        const session = normalizeSessionSnapshot(await readFile(sessionPath, 'utf8'), normalization)
        if (refreshing) await writeFile(sessionExpected, session)
        expect(session).toBe(await readFile(sessionExpected, 'utf8'))
        expect(session).toContain('Archived memories available through `recall_memory`')
        expect(session).toContain('tags: sqlite, migration — database migration decision')
        expect(session).toContain('"name":"memory:catalog"')
      },
    })
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('The archived migration memory is available on demand.')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
