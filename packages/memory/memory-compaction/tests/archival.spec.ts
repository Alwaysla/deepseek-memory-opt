/**
 * memory-compaction integration: a real agent loop, session store, token meter,
 * and local spill backend drive the MemoryCompactionEngine. A mock model both
 * answers turns and writes the tagged checkpoint, so the test exercises the real
 * automatic compaction transaction plus the memory/archived record, the digest
 * card, the spilled copy, idempotent re-archival, and the manual /compact path.
 */

import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmResolvedModelInfo, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import LocalSpillStore from '@deepseek-ai/dsh-spill-local'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MemoryCompactionEngine } from '@deepseek-ai/dsh-memory-compaction'

function userMessage(text: string): ReturnType<typeof createUserMessage> {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

const MODEL = 'mock'
const SIGNAL = new AbortController().signal
const HISTORY = 'older conversation history that must be summarized '.repeat(200)
const CHECKPOINT = '## Current Work\n- wiring the auth flow\n\nTAGS: auth, sqlite, login'
// Compact aggressively: a low threshold makes the next turn's pre-step pressure-compact.
const AUTO_CONFIG = { auto: true, thresholdRatio: 0.005, retainRatio: 0.001 } as const

/** A mock model: normal turns answer briefly; the summarization call returns the tagged checkpoint. */
class MockModel extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 100_000 } })
  }

  override async * stream(options: { messages: readonly Message[]; purpose?: string }): AsyncIterable<StreamChunk> {
    const text = options.purpose === 'compaction' ? CHECKPOINT : 'ok'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

interface Harness {
  ctx: Context
  agent: Agent
  engine: MemoryCompactionEngine
}

let sessionCounter = 0

async function harness(config: Record<string, unknown> = AUTO_CONFIG): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-'))
  await ctx.plugin(LocalSpillStore, { root })
  ctx.llm.registerAdapter([MODEL], new MockModel())
  const engine = new MemoryCompactionEngine(ctx, config)
  const agent = ctx.agentLoop.create(SessionId(`memory-${sessionCounter++}`), { provider: MODEL, model: MODEL })
  return { ctx, agent, engine }
}

/** Run two turns carrying large history, then a third whose pre-step pressure-compacts the older span. */
async function driveAutoCompaction(h: Harness): Promise<void> {
  for (const _ of [0, 1]) {
    h.agent.followup(userMessage(HISTORY))
    await h.agent.whenIdle()
  }
  h.agent.followup(userMessage('continue'))
  await h.agent.whenIdle()
}

function archivedRecords(session: Session): Extract<SessionEvent, { type: 'memory/archived' }>[] {
  return session.events.filter((event): event is Extract<SessionEvent, { type: 'memory/archived' }> => event.type === 'memory/archived')
}

function derivedText(session: Session): string {
  return session.deriveMessages().map(message => message.content.map(block => block.type === 'text' ? block.text : '').join('')).join('\n')
}

describe('MemoryCompactionEngine archival', () => {
  it('records a tagged memory/archived entry, a clean digest card, and an organized spill copy', async () => {
    const h = await harness()
    await driveAutoCompaction(h)

    const records = archivedRecords(h.agent.session)
    expect(records.length).toBeGreaterThanOrEqual(1)
    const record = records[0]!.data
    expect(record.tags).toEqual(['auth', 'sqlite', 'login'])
    expect(record.digest).toContain('wiring the auth flow')
    expect(record.digest).not.toContain('TAGS:')
    expect(record.shadowedSeqs.length).toBeGreaterThan(0)

    // The digest card is on the surface; the raw TAGS line is not.
    expect(derivedText(h.agent.session)).toContain('wiring the auth flow')
    expect(derivedText(h.agent.session)).not.toContain('TAGS:')

    // The organized copy exists on disk and holds the shadowed transcript.
    expect(record.locator).toBeDefined()
    expect(await readFile(record.locator!, 'utf8')).toContain('## user')
  })

  it('is idempotent by content: re-archiving the same span reuses the entry id', async () => {
    const h1 = await harness()
    await driveAutoCompaction(h1)
    const h2 = await harness()
    await driveAutoCompaction(h2)
    expect(archivedRecords(h2.agent.session)[0]!.data.entryId).toBe(archivedRecords(h1.agent.session)[0]!.data.entryId)
  })

  it('archives the manual compactNow path too', async () => {
    const h = await harness({ auto: false })
    h.agent.followup(userMessage(HISTORY))
    await h.agent.whenIdle()
    const result = await h.engine.compactNow(h.agent, SIGNAL)
    expect(result).not.toBeNull()
    expect(archivedRecords(h.agent.session)).toHaveLength(1)
  })

  it('records nothing when a manual compaction finds no compactable span', async () => {
    const h = await harness({ auto: false })
    expect(await h.engine.compactNow(h.agent, SIGNAL)).toBeNull()
    expect(archivedRecords(h.agent.session)).toHaveLength(0)
  })
})
