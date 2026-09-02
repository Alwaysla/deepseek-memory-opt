/** Memory-catalog archive-content projection. @module @deepseek-ai/dsh-memory-core/catalog */

import type { Message, UserMessage } from '@deepseek-ai/dsh-llm'
import { isRuntimeContextMessage, joinContextSections } from '@deepseek-ai/dsh-system-prompt'

/** Stable name of the catalog's aggregate runtime-context section. */
export const MEMORY_CATALOG_CONTEXT = 'memory:catalog'

/**
 * Test whether an aggregate runtime-context snapshot contains the memory catalog.
 * @param message - message derived from the selected compaction range.
 * @returns whether the durable message contains the named catalog section.
 */
export function containsMemoryCatalog(message: Message): boolean {
  return isRuntimeContextMessage(message)
    && message.source.sections?.some(section => section.name === MEMORY_CATALOG_CONTEXT) === true
}

/**
 * Remove only the memory catalog from archival content while preserving every
 * unrelated section of the same aggregate runtime-context snapshot.
 * @param message - one message derived from a selected compaction node.
 * @returns the archive-visible message, or `undefined` when nothing remains.
 */
export function projectMemoryArchiveMessage(message: Message): Message | undefined {
  if (!isRuntimeContextMessage(message)) return message
  const sections = message.source.sections?.filter(section => section.name !== MEMORY_CATALOG_CONTEXT)
  if (sections === undefined) return
  if (sections.length === 0) return
  return {
    ...message,
    content: [{ type: 'text', text: joinContextSections(sections) }],
    source: { ...message.source, sections },
  } satisfies UserMessage
}

/**
 * Project messages to content owned by the memory archive.
 * @param messages - messages derived from the selected compaction span.
 * @returns archive-visible messages in their original order.
 */
export function projectMemoryArchive(messages: readonly Message[]): Message[] {
  return messages.flatMap(message => {
    const projected = projectMemoryArchiveMessage(message)
    return projected === undefined ? [] : [projected]
  })
}
