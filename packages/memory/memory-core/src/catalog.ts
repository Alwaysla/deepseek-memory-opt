/** Memory-catalog archive-content projection. @module @deepseek-ai/dsh-memory-core/catalog */

import type { Message, UserMessage } from '@deepseek-ai/dsh-llm'
import { isRuntimeContextMessage, joinContextSections } from '@deepseek-ai/dsh-system-prompt'

/** Stable name of the catalog's aggregate runtime-context section. */
export const MEMORY_CATALOG_CONTEXT = 'memory:catalog'

/** Runtime-context sections that describe current state rather than episodic memory. */
export const MEMORY_ARCHIVE_EXCLUDED_CONTEXTS = new Set([
  MEMORY_CATALOG_CONTEXT,
  'session:directives',
])

/**
 * Test whether an aggregate runtime-context snapshot contains current state that
 * must not become recallable episodic memory.
 * @param message - message derived from the selected compaction range.
 * @returns whether the durable message contains an archive-excluded section.
 */
export function containsMemoryArchiveExcludedContext(message: Message): boolean {
  return isRuntimeContextMessage(message)
    && message.source.sections?.some(section => MEMORY_ARCHIVE_EXCLUDED_CONTEXTS.has(section.name)) === true
}

/**
 * Remove current-state sections from archival content while preserving every
 * episodic section of the same aggregate runtime-context snapshot.
 * @param message - one message derived from a selected compaction node.
 * @returns the archive-visible message, or `undefined` when nothing remains.
 */
export function projectMemoryArchiveMessage(message: Message): Message | undefined {
  if (!isRuntimeContextMessage(message)) return message
  const sections = message.source.sections?.filter(section => !MEMORY_ARCHIVE_EXCLUDED_CONTEXTS.has(section.name))
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
  return messages.flatMap((message) => {
    const projected = projectMemoryArchiveMessage(message)
    return projected === undefined ? [] : [projected]
  })
}
