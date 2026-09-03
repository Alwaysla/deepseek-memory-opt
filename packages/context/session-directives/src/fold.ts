/** Strict decoding and pure last-wins replay for durable session directives. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DirectiveChange, SessionDirective, SessionDirectivesProjection } from './types.ts'

/** Empty directive state used before the first durable change. */
export const EMPTY_DIRECTIVES: SessionDirectivesProjection = Object.freeze({ directives: Object.freeze([]) })

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], subject: string): void {
  const actual = Object.keys(value).sort().join(',')
  const wanted = [...expected].sort().join(',')
  if (actual !== wanted) throw new Error(`${subject} must have exactly ${wanted} fields`)
}

function normalizedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new Error(`directive ${field} must be a non-empty normalized string`)
  }
  return value
}

/**
 * Strictly decode one value that identifies itself as a directive change.
 * @param value - candidate durable payload.
 * @returns a detached canonical change, or `undefined` for another payload kind.
 */
export function decodeDirectiveChange(value: unknown): DirectiveChange | undefined {
  if (!record(value) || value['kind'] !== 'directive/change') return undefined
  exactKeys(value, ['directives', 'kind', 'version'], 'directive change')
  if (value['version'] !== 1) throw new Error(`unsupported directive change version ${String(value['version'])}`)
  if (!Array.isArray(value['directives'])) throw new Error('directive change directives must be an array')
  const seen = new Set<string>()
  const directives = value['directives'].map((candidate, index): SessionDirective => {
    if (!record(candidate)) throw new Error(`directive at index ${index} must be a record`)
    exactKeys(candidate, ['key', 'scope', 'source', 'value'], `directive at index ${index}`)
    const scope = normalizedString(candidate['scope'], 'scope')
    if (scope !== 'session') throw new Error('directive scope must be "session"')
    const directive: SessionDirective = {
      key: normalizedString(candidate['key'], 'key'),
      value: normalizedString(candidate['value'], 'value'),
      source: normalizedString(candidate['source'], 'source'),
      scope,
    }
    if (seen.has(directive.key)) throw new Error(`directive key ${JSON.stringify(directive.key)} is duplicated`)
    seen.add(directive.key)
    return directive
  })
  return { kind: 'directive/change', version: 1, directives }
}

/**
 * Apply one event to an immutable directive projection.
 * @param state - projection covering preceding events.
 * @param event - next event in sequence order.
 * @returns a fresh whole state for a directive change, otherwise the same reference.
 */
export function applyDirectiveEvent(
  state: SessionDirectivesProjection,
  event: SessionEvent,
): SessionDirectivesProjection {
  if (event.type !== 'directive/change') return state
  const change = decodeDirectiveChange(event.data)
  if (change === undefined) throw new Error(`directive change at session event ${event.seq} has an invalid kind`)
  return { directives: change.directives }
}

/**
 * Replay the active directives from a session event sequence.
 * @param events - durable events in sequence order.
 * @returns detached current state; the latest complete change wins.
 */
export function foldSessionDirectives(events: readonly SessionEvent[]): SessionDirectivesProjection {
  let state = EMPTY_DIRECTIVES
  for (const event of events) state = applyDirectiveEvent(state, event)
  return { directives: state.directives.map(directive => ({ ...directive })) }
}
