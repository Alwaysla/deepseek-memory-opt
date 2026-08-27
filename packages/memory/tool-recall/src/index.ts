/**
 * Model-facing `recall_memory` tool. Fetches conversation spans that were
 * archived under retrieval tags during compaction and returns them to the model,
 * reconstructed from the durable session log at each entry's shadowed seqs (not
 * from the on-disk copy), so recall is deterministic under replay. Registering
 * this plugin adds the tool; it reads the `memoryIndex` projection when the
 * session-projection seam is composed.
 *
 * @module @deepseek-ai/dsh-tool-recall
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessionProjections and the memoryIndex projection key.
import type {} from '@deepseek-ai/dsh-session-projection'
import { RECALL_TOOL_NAME } from '@deepseek-ai/dsh-memory-core'
import type { MemoryEntry } from '@deepseek-ai/dsh-memory-core/types'

export const name = 'tool-recall'
export const inject = ['tools']

/** Concatenate the text of a block sequence, ignoring non-text blocks. */
function textOf(blocks: readonly ContentBlock[]): string {
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Reconstruct one archived span as a readable transcript from its shadowed log seqs. */
function reconstruct(session: Session, shadowedSeqs: readonly number[]): string {
  const events = session.events
  const parts: string[] = []
  for (const seq of shadowedSeqs) {
    const event = events[seq]
    if (event === undefined) continue
    const message: Message | null = session.deriveEventMessage(event)
    if (message === null) continue
    parts.push(`## ${message.role}\n${textOf(message.content)}`)
  }
  return parts.join('\n\n')
}

/** Entries whose tags intersect the requested tags, in stable id order. */
function matchEntries(entries: Record<string, MemoryEntry>, requested: readonly string[]): MemoryEntry[] {
  const wanted = new Set(requested.map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0))
  return Object.values(entries).filter(entry => entry.tags.some(tag => wanted.has(tag)))
}

/**
 * Register the `recall_memory` tool on `ctx.tools`. The tool reads the
 * `memoryIndex` projection through `ctx.sessionProjections` when composed;
 * without that seam it returns no memories.
 * @param ctx - registrant context carrying the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: RECALL_TOOL_NAME,
    description:
      'Retrieve earlier conversation context that was condensed into a checkpoint, by topic tag. '
      + 'A checkpoint lists the tags it archived; pass one or more of those tags to pull the full '
      + 'original span back so you can continue work that depended on it. Returns every archived '
      + 'span whose tags match.',
    parameters: {
      tags: {
        type: 'array',
        required: true,
        description: 'One or more topic tags to match, e.g. from a checkpoint\'s tag list.',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          memories: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                entryId: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                digest: { type: 'string', required: true },
                content: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.memories.length === 0
          ? 'No archived memory matched those tags.'
          : value.memories.map(memory => `<recalled-memory tags="${memory.tags.join(', ')}">\n${memory.content}\n</recalled-memory>`).join('\n\n'),
      }],
    },
    execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error('recall_memory requires an agent session')
      }
      const projections = ctx.get('sessionProjections')
      const index = projections?.stateOf(agent.session, 'memoryIndex')
      const matched = index === undefined ? [] : matchEntries(index.entries, args.tags)
      return Promise.resolve({
        memories: matched.map(entry => ({
          entryId: entry.entryId,
          tags: entry.tags,
          digest: entry.digest,
          content: reconstruct(agent.session, entry.shadowedSeqs),
        })),
      })
    },
  }))
}
