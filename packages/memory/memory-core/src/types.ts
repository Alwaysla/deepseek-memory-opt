/**
 * Pure vocabulary of the tag-indexed memory domain: the `EntryId` brand, the
 * `memory/archived` session event, and the `memoryIndex` projection key. This is
 * the one home of these declarations, free of host-side value imports so client
 * and host aggregates share the same declaration-merged tables.
 *
 * @module @deepseek-ai/dsh-memory-core/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Opaque content-hash identity of one archived conversation span. Semantically
 * equal spans hash equal, so re-archiving a span (e.g. after it was recalled
 * and folded back) resolves to the same id and stays idempotent.
 */
export type EntryId = Branded<'EntryId'>

/**
 * One archived span's index record. The span's raw events remain in the session
 * log at {@link MemoryEntry.shadowedSeqs}; recall reconstructs the span from
 * those seqs, so this record is a tag index over durable log data, not the sole
 * copy.
 */
export interface MemoryEntry {
  /** Content-hash identity; re-archiving the same span yields the same id. */
  entryId: EntryId
  /** Retrieval tags the archiving model assigned to this span. */
  tags: string[]
  /** Short human-facing digest of the span, shown on the compaction card. */
  digest: string
  /** Surface-node seqs of the shadowed span, in surface order; recall reconstructs from these. */
  shadowedSeqs: number[]
  /** Heuristic token count of the shadowed span under the token meter's estimator. */
  shadowedTokenCount: number
  /** Seq of the `compaction/summary` event this archive accompanies. */
  summarySeq: number
  /** Organized on-disk copy's spill locator, when a spill backend was composed. */
  locator?: string
}

/** Host fold-state and wire value of the `memoryIndex` projection: every archived span keyed by id. */
export interface MemoryIndexState {
  /** Archived spans keyed by {@link MemoryEntry.entryId}; last-wins by the whole-value rule. */
  entries: Record<string, MemoryEntry>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One archived conversation span's index record — log-only, no surfaceOp.
     * Appended after a compaction transaction commits, so every record refers to
     * a span already shadowed on the surface. Purely informational: the span's
     * raw events remain in the log at `shadowedSeqs`, so losing this record loses
     * only the tag index, never reconstructability.
     * @param data - the archived span's tags, digest, shadowed seqs, and token count.
     */
    'memory/archived': MemoryEntry
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    memoryIndex: MemoryIndexState
  }
  interface SessionProjectionMap {
    /**
     * The whole tag index: every archived span keyed by entry id. Whole-value
     * rule: each `memory/archived` record carries the complete entry, so the
     * fold merges last-wins by id and re-archiving an equal span is a no-op.
     */
    memoryIndex: MemoryIndexState
  }
}
