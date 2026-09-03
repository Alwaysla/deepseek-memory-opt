/** Origin of a persistent session directive. */
export type SessionDirectiveSource = string

/** One Host-projected persistent session directive. */
export interface SessionDirectiveEntry {
  readonly key: string
  readonly value: string
  readonly source: SessionDirectiveSource
  readonly scope: 'session'
}

/** Whole-value session projection consumed by the view. */
export interface SessionDirectivesProjection {
  readonly directives: readonly SessionDirectiveEntry[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Current persistent directives for this session. */
    sessionDirectives: SessionDirectivesProjection
  }
}
