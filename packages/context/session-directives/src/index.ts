/**
 * Durable same-session directives, authoritative mutations, replay projection,
 * and bounded runtime-context rendering.
 * @module @deepseek-ai/dsh-session-directives
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { applyDirectiveEvent, decodeDirectiveChange, foldSessionDirectives } from './fold.ts'
import type { DirectiveChange, SessionDirective, SessionDirectivesProjection } from './types.ts'

export type * from './types.ts'
export { applyDirectiveEvent, decodeDirectiveChange, foldSessionDirectives } from './fold.ts'

/** Default maximum active directive count. */
export const DEFAULT_MAX_ENTRIES = 12
/** Default maximum estimated tokens in the complete rendered contribution. */
export const DEFAULT_MAX_TOKENS = 256
/** Default maximum Unicode code points in one directive value. */
export const DEFAULT_VALUE_MAX_CHARS = 200
/** Registered dynamic runtime-context name. */
export const SESSION_DIRECTIVES_CONTEXT = 'session:directives'

/** Deployment limits for accepted directive state. */
export interface Config {
  /** Maximum active directive count. Defaults to 12. */
  maxEntries?: number
  /** Maximum estimated tokens in the complete rendered contribution. Defaults to 256. */
  maxTokens?: number
  /** Maximum Unicode code points in one directive value. Defaults to 200. */
  valueMaxChars?: number
}

/** Stable rejection categories exposed by {@link SessionDirectivesError}. */
export type SessionDirectivesErrorCode =
  | 'SESSION_DIRECTIVES_INVALID_CONFIG'
  | 'SESSION_DIRECTIVES_INVALID_DIRECTIVE'
  | 'SESSION_DIRECTIVES_TOO_MANY_ENTRIES'
  | 'SESSION_DIRECTIVES_VALUE_TOO_LONG'
  | 'SESSION_DIRECTIVES_BUDGET_EXCEEDED'

/** Caller-visible validation or budget rejection. */
export class SessionDirectivesError extends Error {
  /** Stable machine-readable classification. */
  readonly code: SessionDirectivesErrorCode

  /** @param message - human-readable correction. @param code - stable rejection category. */
  constructor(message: string, code: SessionDirectivesErrorCode) {
    super(message)
    this.name = 'SessionDirectivesError'
    this.code = code
  }
}

/** Input accepted by {@link SessionDirectivesService.set}. */
export interface SetDirectiveRequest {
  readonly key: string
  readonly value: string
  readonly source: string
  readonly scope: 'session'
}

interface DirectiveAssembleContext extends AssembleContext {
  readonly agent?: { readonly session: Session }
}

interface ResolvedConfig {
  readonly maxEntries: number
  readonly maxTokens: number
  readonly valueMaxChars: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionDirectives: SessionDirectivesService
  }
}

const projectionSchema: ProjectionDefinition<
  'sessionDirectives',
  SessionDirectivesProjection
>['stateSchema'] = {
  parse(value: unknown): SessionDirectivesProjection {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('sessionDirectives projection must be a record')
    }
    if (Object.keys(value).length !== 1 || !('directives' in value)) {
      throw new Error('sessionDirectives projection must contain only directives')
    }
    const change = decodeDirectiveChange({
      kind: 'directive/change',
      version: 1,
      directives: (value as { directives?: unknown }).directives,
    })
    if (change === undefined) throw new Error('sessionDirectives projection is invalid')
    return { directives: change.directives }
  },
} as ProjectionDefinition<'sessionDirectives', SessionDirectivesProjection>['stateSchema']

function positiveSafeInteger(value: number, name: keyof ResolvedConfig): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SessionDirectivesError(
      `session-directives: ${name} must be a positive safe integer`,
      'SESSION_DIRECTIVES_INVALID_CONFIG',
    )
  }
  return value
}

function normalize(value: unknown, field: keyof SetDirectiveRequest): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SessionDirectivesError(
      `session-directives: ${field} must be a non-empty string`,
      'SESSION_DIRECTIVES_INVALID_DIRECTIVE',
    )
  }
  return value.trim()
}

/**
 * Render the complete package-owned runtime-context contribution.
 * @param directives - active directives in stable projection order.
 * @returns empty text for no directives, otherwise the complete model-visible section.
 */
export function renderSessionDirectives(directives: readonly SessionDirective[]): string {
  if (directives.length === 0) return ''
  return [
    'Session directives:',
    ...directives.map(directive =>
      `- [${directive.scope}] ${directive.key} (source: ${directive.source}): ${directive.value}`),
  ].join('\n')
}

/**
 * Apply the fixed-density estimate used by runtime-context token budgets.
 * @param text - complete rendered contribution.
 * @returns conservative estimated token count.
 */
export function estimateDirectiveTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Durable session-directive service (`ctx.sessionDirectives`). */
export class SessionDirectivesService extends Service {
  static inject = ['systemPrompt']
  static Config: z<Config> = z.object({
    maxEntries: z.number().step(1).min(1).default(DEFAULT_MAX_ENTRIES),
    maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
    valueMaxChars: z.number().step(1).min(1).default(DEFAULT_VALUE_MAX_CHARS),
  })

  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'sessionDirectives')
    this.config = {
      maxEntries: positiveSafeInteger(config.maxEntries ?? DEFAULT_MAX_ENTRIES, 'maxEntries'),
      maxTokens: positiveSafeInteger(config.maxTokens ?? DEFAULT_MAX_TOKENS, 'maxTokens'),
      valueMaxChars: positiveSafeInteger(config.valueMaxChars ?? DEFAULT_VALUE_MAX_CHARS, 'valueMaxChars'),
    }
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'sessionDirectives', SessionDirectivesProjection>({
        key: 'sessionDirectives',
        stateSchema: projectionSchema,
        init: () => ({ directives: [] }),
        apply: applyDirectiveEvent,
        wire: { viewSchema: projectionSchema, view: state => state },
        stateVersion: 1,
      })
    })
    ctx.systemPrompt.context({
      name: SESSION_DIRECTIVES_CONTEXT,
      order: 100,
      text: assembly => this.contextText(assembly),
    })
  }

  /**
   * List active directives in stable order.
   * @param session - owning session.
   * @returns a detached list reconstructed from its durable log.
   */
  list(session: Session): SessionDirective[] {
    const directives = foldSessionDirectives(session.events).directives
    this.validateState(directives)
    return directives.map(directive => ({ ...directive }))
  }

  /**
   * Add or replace one directive by stable key and append the complete resulting state.
   * Existing keys retain their position. Rejected writes append nothing.
   * @param session - owning session.
   * @param request - directive value and required source/scope attribution.
   * @returns a detached accepted directive.
   * @throws {@link SessionDirectivesError} when input or complete rendered state exceeds a configured limit.
   */
  set(session: Session, request: SetDirectiveRequest): SessionDirective {
    const directive: SessionDirective = {
      key: normalize(request.key, 'key'),
      value: normalize(request.value, 'value'),
      source: normalize(request.source, 'source'),
      scope: request.scope,
    }
    if ([...directive.value].length > this.config.valueMaxChars) {
      throw new SessionDirectivesError(
        `session-directives: value for ${JSON.stringify(directive.key)} exceeds ${this.config.valueMaxChars} characters`,
        'SESSION_DIRECTIVES_VALUE_TOO_LONG',
      )
    }
    const directives = this.list(session)
    const index = directives.findIndex(current => current.key === directive.key)
    if (index < 0) directives.push(directive)
    else directives[index] = directive
    this.commit(session, directives)
    return { ...directive }
  }

  /**
   * Remove one stable key and append the complete resulting state.
   * @param session - owning session.
   * @param key - exact normalized key to remove.
   * @returns whether the key existed; an absent key appends no event.
   */
  remove(session: Session, key: string): boolean {
    const normalized = normalize(key, 'key')
    const current = this.list(session)
    const directives = current.filter(directive => directive.key !== normalized)
    if (directives.length === current.length) return false
    this.commit(session, directives)
    return true
  }

  /**
   * Clear all active directives with one complete-state event.
   * @param session - owning session.
   * @returns whether any directive existed; an empty state appends no event.
   */
  clear(session: Session): boolean {
    if (this.list(session).length === 0) return false
    this.commit(session, [])
    return true
  }

  private contextText(assembly: AssembleContext): string {
    const session = (assembly as DirectiveAssembleContext).agent?.session
    return session === undefined ? '' : renderSessionDirectives(this.list(session))
  }

  private validateState(directives: readonly SessionDirective[]): void {
    if (directives.length > this.config.maxEntries) {
      throw new SessionDirectivesError(
        `session-directives: state has ${directives.length} entries; maximum is ${this.config.maxEntries}`,
        'SESSION_DIRECTIVES_TOO_MANY_ENTRIES',
      )
    }
    const rendered = renderSessionDirectives(directives)
    const tokens = estimateDirectiveTokens(rendered)
    if (tokens > this.config.maxTokens) {
      throw new SessionDirectivesError(
        `session-directives: complete rendered context needs ${tokens} estimated tokens; maximum is ${this.config.maxTokens}`,
        'SESSION_DIRECTIVES_BUDGET_EXCEEDED',
      )
    }
    for (const directive of directives) {
      if ([...directive.value].length > this.config.valueMaxChars) {
        throw new SessionDirectivesError(
          `session-directives: value for ${JSON.stringify(directive.key)} exceeds ${this.config.valueMaxChars} characters`,
          'SESSION_DIRECTIVES_VALUE_TOO_LONG',
        )
      }
    }
  }

  private commit(session: Session, directives: readonly SessionDirective[]): void {
    this.validateState(directives)
    const change: DirectiveChange = {
      kind: 'directive/change',
      version: 1,
      directives: directives.map(directive => ({ ...directive })),
    }
    session.append('directive/change', change)
  }
}

export default SessionDirectivesService
