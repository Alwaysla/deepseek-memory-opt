/**
 * Tag-indexed memory foundation: the content-hash {@link entryIdFor} identity
 * constructor and the `memoryIndex` session projection that folds
 * `memory/archived` records into a tag index. Registering this plugin adds the
 * projection unit when the session-projection seam is composed; headless
 * assemblies without it stay unaffected.
 *
 * @module @deepseek-ai/dsh-memory-core
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Message } from '@deepseek-ai/dsh-llm'
// Type-only: resolves ctx.sessionProjections for the optional unit child.
import type {} from '@deepseek-ai/dsh-session-projection'
import type { EntryId, MemoryEntry, MemoryIndexState } from './types.ts'
// The `memory/archived` and `memoryIndex` declarations live in src/types.ts (their
// one home); this re-export projects the type face onto the package root AND keeps
// the module edge in the emitted index.d.ts, so aggregate programs consuming the
// declarations still receive the merges.
export type * from './types.ts'

export const name = 'memory-core'

/**
 * The recall tool's model-facing name. A protocol constant shared by the tool
 * that registers it and the TTL pruner that recognizes its results by the
 * paired `tool/call` name; both import it from here so the identifier has one home.
 */
export const RECALL_TOOL_NAME = 'recall_memory'

/**
 * Brand a hex string as an {@link EntryId}.
 * @param hex - the content-hash digest to brand.
 * @returns the branded entry id.
 */
export function EntryId(hex: string): EntryId {
  return hex as EntryId
}

/**
 * Content-hash identity of an archived span. Hashes the messages' roles and
 * content only — message ids are excluded so a span recalled and re-archived
 * hashes equal to its original, keeping archival idempotent.
 * @param messages - the shadowed region's derived messages, in surface order.
 * @returns the span's stable {@link EntryId}.
 */
export function entryIdFor(messages: readonly Message[]): EntryId {
  const canonical = JSON.stringify(messages, (key: string, value: unknown) => (key === 'id' ? undefined : value))
  return EntryId(createHash('sha256').update(canonical).digest('hex'))
}

/** Wire and host-state schema of one {@link MemoryEntry}. */
const entrySchema = zod.object({
  entryId: zod.string(),
  tags: zod.array(zod.string()),
  digest: zod.string(),
  shadowedSeqs: zod.array(zod.number()),
  shadowedTokenCount: zod.number(),
  summarySeq: zod.number(),
  locator: zod.string().optional(),
}) as unknown as ZodType<MemoryEntry>

/** Wire and host-state schema of the whole {@link MemoryIndexState}. */
const stateSchema: ZodType<MemoryIndexState> = zod.object({
  entries: zod.record(zod.string(), entrySchema),
})

/**
 * Register the `memoryIndex` projection when a projection registry is composed.
 * The fold merges each `memory/archived` record last-wins by entry id and
 * returns the same state reference for every other event.
 * @param ctx - registrant context; the unit child activates only under `ctx.sessionProjections`.
 */
export function apply(ctx: Context): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register<'memoryIndex', MemoryIndexState>({
      key: 'memoryIndex',
      stateSchema,
      init: () => ({ entries: {} }),
      apply: (state, event) => {
        if (event.type === 'memory/archived') {
          return { entries: { ...state.entries, [event.data.entryId]: event.data } }
        }
        return state
      },
      wire: { viewSchema: stateSchema, view: state => state },
      stateVersion: 0,
    })
  })
}
