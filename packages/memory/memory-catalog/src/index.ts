/**
 * Bounded model-facing catalog of memories available through `recall_memory`.
 * The catalog is a named runtime-context section derived from `memoryIndex` and
 * is materialized by the agent loop as part of its durable aggregate snapshot.
 *
 * @module @deepseek-ai/dsh-memory-catalog
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'

declare module '@deepseek-ai/dsh-system-prompt' {
  interface AssembleContext {
    /** Agent whose memory projection is rendered. */
    agent?: Agent
  }
}
import { MEMORY_CATALOG_CONTEXT, type MemoryEntry } from '@deepseek-ai/dsh-memory-core'
// Type-only: resolves the required projection service.
import type {} from '@deepseek-ai/dsh-session-projection'
/** Default maximum number of recent archive entries shown. */
export const DEFAULT_MAX_ENTRIES = 20
/** Default maximum estimated tokens for the complete catalog message. */
export const DEFAULT_MAX_TOKENS = 1200
/** Default maximum characters retained from one archive digest. */
export const DEFAULT_DIGEST_MAX_CHARS = 160

/** Deployment policy for the bounded memory catalog. */
export interface Config {
  /** Maximum recent archive entries shown. Defaults to 20. */
  maxEntries?: number
  /** Maximum estimated tokens for the complete publication. Defaults to 1200. */
  maxTokens?: number
  /** Maximum characters from each digest before ellipsis. Defaults to 160. */
  digestMaxChars?: number
}

interface CatalogEntry {
  tags: string[]
  digest: string
}

interface ResolvedConfig {
  maxEntries: number
  maxTokens: number
  digestMaxChars: number
}

export const name = 'memory-catalog'
export const inject = ['sessionProjections', 'systemPrompt']
export const Config: z<Config> = z.object({
  maxEntries: z.number().step(1).min(1).default(DEFAULT_MAX_ENTRIES),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  digestMaxChars: z.number().step(1).min(1).default(DEFAULT_DIGEST_MAX_CHARS),
})

/** Bound one digest without splitting JavaScript code points. */
function boundDigest(value: string, maxChars: number): string {
  const chars = [...value]
  return chars.length <= maxChars ? value : `${chars.slice(0, Math.max(0, maxChars - 1)).join('')}…`
}

/** Newest-first catalog entries with model-facing fields only. */
function recentEntries(entries: Record<string, MemoryEntry>, config: ResolvedConfig): CatalogEntry[] {
  return Object.values(entries)
    .sort((left, right) => right.summarySeq - left.summarySeq || left.entryId.localeCompare(right.entryId))
    .slice(0, config.maxEntries)
    .map(entry => ({ tags: [...entry.tags], digest: boundDigest(entry.digest, config.digestMaxChars) }))
}

/** Render one complete catalog publication. */
function render(entries: readonly CatalogEntry[]): string {
  return [
    'Archived memories available through `recall_memory`:',
    ...entries.map(entry => `- tags: ${entry.tags.join(', ')} — ${entry.digest}`),
    'Use `recall_memory` with one or more listed tags only when earlier detail is needed.',
  ].join('\n')
}

/** Fit the complete rendered section to the configured token budget. */
function fitEntries(entries: CatalogEntry[], maxTokens: number): CatalogEntry[] {
  const fitted = [...entries]
  while (fitted.length > 0 && Math.ceil(render(fitted).length / 4) > maxTokens) fitted.pop()
  return fitted
}

/** Render one agent's bounded catalog from its durable projection. */
function catalogText(ctx: Context, assembly: AssembleContext, config: ResolvedConfig): string {
  const session = assembly.agent?.session
  if (session === undefined) return ''
  const index = ctx.sessionProjections.stateOf(session, 'memoryIndex')
  const entries = fitEntries(recentEntries(index?.entries ?? {}, config), config.maxTokens)
  return entries.length === 0 ? '' : render(entries)
}

/** Register the agent-scoped dynamic runtime-context contribution. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved: ResolvedConfig = {
    maxEntries: config.maxEntries ?? DEFAULT_MAX_ENTRIES,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    digestMaxChars: config.digestMaxChars ?? DEFAULT_DIGEST_MAX_CHARS,
  }
  ctx.systemPrompt.context({
    name: MEMORY_CATALOG_CONTEXT,
    order: 100,
    text: assembly => catalogText(ctx, assembly, resolved),
  })
}
