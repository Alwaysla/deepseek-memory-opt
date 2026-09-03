import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { normalizeSessionSnapshot, type NormalizeContext } from '@deepseek-ai/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'session-directives-snapshots/prepopulated')
const replayFixture = join(fixtureDir, 'replay.jsonl')
const replayOverride = join(fixtureDir, 'replay.override.json')
const sessionExpected = join(fixtureDir, 'session.expected.jsonl')
const configPath = fileURLToPath(new URL('../session-directives.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const sessionId = SessionId('session-directives-prepopulated')
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'
const task = 'Apply the active response preference.'

async function seedDirectiveSession(root: string, cwd: string): Promise<string> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  const meta: SessionHeader = {
    version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, cwd, delegationDepth: 0,
  }
  const events: SessionEvent[] = [{ type: 'session/end-seed', seq: 0, time: 10, data: {} }]
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

describe('session directives snapshot', () => {
  it('publishes a durable directive through the headless model request', async () => {
    let cwd = ''
    let sessionPath = ''
    const result = await runLoaderSmoke({
      label: 'session directives headless snapshot', tempDirPrefix: 'dsh-session-directives-snapshot-',
      binScript, libBinScript: binScript, configPath, binArgs: [configPath, task], tsconfigPath,
      env: { DSH_SNAPSHOT_FILE: replayFixture, DSH_SNAPSHOT_OVERRIDE: replayOverride },
      prepare: async (runCwd) => {
        cwd = runCwd
        sessionPath = await seedDirectiveSession(join(runCwd, '.sessions'), runCwd)
      },
      inspect: async () => {
        const normalization: NormalizeContext = { sessionIds: [sessionId], cwd }
        const session = normalizeSessionSnapshot(await readFile(sessionPath, 'utf8'), normalization)
        if (refreshing) await writeFile(sessionExpected, session)
        expect(session).toBe(await readFile(sessionExpected, 'utf8'))
        expect(session).toContain('Session directives:')
        expect(session).toContain('[session] response.concise (source: user): Keep responses concise unless the user asks for detail.')
        expect(session).toContain('\"name\":\"session:directives\"')
      },
    })
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('I will keep this response concise.')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
