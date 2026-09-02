/**
 * Tag-indexed archival compaction backend. A {@link BasicCompactionEngine}
 * subclass that (1) asks the summarizer for retrieval tags via an extended
 * instruction, (2) writes an organized on-disk copy of each shadowed span
 * through `ctx.spillStore`, and (3) appends a `memory/archived` index record
 * after the compaction transaction commits, so a companion recall tool can
 * fetch the span by tag. The span's raw events stay in the log; the archive is
 * an index plus an organized copy, never the sole store.
 *
 * @module @deepseek-ai/dsh-memory-compaction
 */

import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { SummarizationInput, SummaryResult } from '@deepseek-ai/dsh-compaction-basic'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction'
import { containsMemoryCatalog, entryIdFor, projectMemoryArchive } from '@deepseek-ai/dsh-memory-core'
import type { EntryId } from '@deepseek-ai/dsh-memory-core/types'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: makes injected services resolvable on Context.
import type {} from '@deepseek-ai/dsh-spill'
import type {} from '@deepseek-ai/dsh-token-meter'

/**
 * Appended to the base compaction directive so the model emits retrieval tags.
 * The TAGS line is the only content permitted after the checkpoint sections, so
 * {@link splitDigestAndTags} can strip it and keep a clean digest card.
 */
const TAG_ADDENDUM = [
  '',
  'After the checkpoint above, output ONE final line, exactly in this form:',
  'TAGS: tag1, tag2, tag3',
  'Give 3 to 7 short lowercase retrieval tags — single words or hyphenated, comma-separated — naming the span\'s topics, files, or subsystems. The TAGS line is the ONLY content allowed after the checkpoint sections.',
].join('\n')

/** Fallback tag when the model emits no parseable TAGS line, so the entry stays recallable. */
const FALLBACK_TAG = 'general'

/** Concatenate the text of a block sequence, ignoring non-text blocks. */
function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Split a tagged checkpoint into its digest text and retrieval tags. The digest
 * is everything before the trailing `TAGS:` line; tags are parsed from that
 * line, lowercased and de-duplicated. A missing line yields {@link FALLBACK_TAG}.
 * @param blocks - the summarizer's returned summary blocks.
 * @returns the digest text and the parsed tag list.
 */
export function splitDigestAndTags(blocks: readonly ContentBlock[]): { digestText: string; tags: string[] } {
  const body = textOf(blocks).replace(/\s+$/, '')
  const lastNewline = body.lastIndexOf('\n')
  const lastLine = body.slice(lastNewline + 1)
  if (!/^\s*TAGS:/i.test(lastLine)) {
    return { digestText: body, tags: [FALLBACK_TAG] }
  }
  const rest = lastLine.replace(/^\s*TAGS:\s*/i, '')
  const tags = [...new Set(rest.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0))]
  const digestText = lastNewline < 0 ? '' : body.slice(0, lastNewline).trimEnd()
  return { digestText, tags: tags.length > 0 ? tags : [FALLBACK_TAG] }
}

/** Render the shadowed messages as a readable role-labelled transcript for the on-disk copy. */
function renderTranscript(messages: readonly Message[]): string {
  return messages.map(message => `## ${message.role}\n${textOf(message.content)}`).join('\n\n')
}

/**
 * Compaction backend that archives each shadowed span under retrieval tags. Keeps
 * `BasicCompactionEngine`'s replay-and-price machinery and only (a) extends the
 * summarization directive and (b) records an index entry after each committed
 * transaction. `spillStore` is a required injection: this backend's purpose is
 * the organized on-disk copy.
 */
export class MemoryCompactionEngine extends BasicCompactionEngine {
  static override inject = ['llm', 'tokenMeter', 'sessions', 'spillStore']

  /**
   * Metadata captured during `summarize()` and consumed once the enclosing
   * transaction commits. Single-slot: the compaction seam serializes every
   * transaction under one lock, so at most one archive is ever pending.
   */
  private pendingArchive: {
    entryId: EntryId
    tags: string[]
    digest: string
    locator: string
    archivedSeqs: number[]
  } | undefined

  protected override summaryInstruction(): string {
    return `${super.summaryInstruction()}\n${TAG_ADDENDUM}`
  }

  protected override async summarize(
    input: SummarizationInput,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<SummaryResult> {
    const archivedMessageIndexes = input.messages
      .map((message, index) => containsMemoryCatalog(message) ? -1 : index)
      .filter(index => index >= 0)
    const archiveMessages = projectMemoryArchive(input.messages)
    const result = await super.summarize({
      ...input,
      messages: archiveMessages,
      ...input.messageSeqs === undefined ? {} : {
        messageSeqs: input.messageSeqs.filter((_seq, index) => archivedMessageIndexes.includes(index)),
      },
    }, agent, signal)
    const entryId = entryIdFor(archiveMessages)
    const { digestText, tags } = splitDigestAndTags(result.summary)
    const locator = await this.archive(agent, entryId, tags, archiveMessages)
    const archivedSeqs = input.messageSeqs?.filter((_seq, index) => archivedMessageIndexes.includes(index)) ?? []
    this.pendingArchive = { entryId, tags, digest: digestText, locator, archivedSeqs }
    return { ...result, summary: [{ type: 'text', text: digestText }] }
  }

  override async compactRegion(
    start: number,
    end: number,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    this.pendingArchive = undefined
    const result = await super.compactRegion(start, end, agent, signal)
    this.recordArchive(agent.session, result)
    return result
  }

  override async compactNow(
    agent: Agent,
    signal: AbortSignal,
    sourceCommandId?: Parameters<BasicCompactionEngine['compactNow']>[2],
  ): Promise<CompactionResult | null> {
    this.pendingArchive = undefined
    const result = await super.compactNow(agent, signal, sourceCommandId)
    if (result !== null) this.recordArchive(agent.session, result)
    return result
  }

  /**
   * Append the pending `memory/archived` index record for a committed
   * compaction. Runs after the transaction closes, so a record only ever refers
   * to a span already shadowed on the surface.
   * @param session - the compacted session.
   * @param result - the committed compaction result carrying the shadowed seqs.
   */
  private recordArchive(session: Session, result: CompactionResult): void {
    // A committed compaction always ran summarize(), which set pendingArchive.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const pending = this.pendingArchive!
    this.pendingArchive = undefined
    const shadowedSeqs = pending.archivedSeqs
    if (shadowedSeqs.length === 0) return
    const shadowedTokenCount = shadowedSeqs.reduce((total, seq) => {
      const event = session.events[seq]
      if (event === undefined) return total
      const message = session.deriveEventMessage(event)
      return total + (message === null ? 0 : this.ctx.tokenMeter.estimateMessage(message))
    }, 0)
    session.append('memory/archived', {
      entryId: pending.entryId,
      tags: pending.tags,
      digest: pending.digest,
      shadowedSeqs,
      shadowedTokenCount,
      summarySeq: result.summarySeq,
      locator: pending.locator,
    })
  }

  /**
   * Write the organized on-disk copy of one shadowed span through
   * `ctx.spillStore`. Idempotent by content: the entry id derives from the same
   * span, and equal spans produce equal content, so re-archiving overwrites the
   * same logical artifact rather than duplicating it.
   * @param agent - owner of the target session (spill storage namespace).
   * @param entryId - the span's content-hash identity.
   * @param tags - retrieval tags, used for a readable suggested filename.
   * @param messages - the shadowed span's messages, in surface order.
   * @returns the artifact's spill locator.
   */
  private async archive(
    agent: Agent,
    entryId: EntryId,
    tags: string[],
    messages: readonly Message[],
  ): Promise<string> {
    const ref = await this.ctx.spillStore.saveText({
      owner: { sessionId: agent.session.id },
      source: { toolName: 'memory', callId: CallId(`memory-${entryId.slice(0, 16)}`), label: tags.join(',') },
      suggestedName: `${tags[0]}-${entryId.slice(0, 8)}.txt`,
      content: renderTranscript(messages),
    })
    return ref.locator
  }
}

export default MemoryCompactionEngine
