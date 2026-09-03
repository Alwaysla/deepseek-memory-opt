/** Pure durable and projection types for same-session directives. @module @deepseek-ai/dsh-session-directives/types */

/** One active directive, identified and replaced by its stable key. */
export interface SessionDirective {
  /** Stable non-empty key used by set and remove. */
  readonly key: string
  /** Model-facing directive text. */
  readonly value: string
  /** Non-empty producer identifier retained for attribution. */
  readonly source: string
  /** V1 applicability is restricted to the owning session. */
  readonly scope: 'session'
}

/** Complete post-change state carried by every durable directive mutation. */
export interface DirectiveChange {
  readonly kind: 'directive/change'
  readonly version: 1
  readonly directives: readonly SessionDirective[]
}

/** Host and wire projection of the active directive list. */
export interface SessionDirectivesProjection {
  readonly directives: readonly SessionDirective[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Complete active directive state after one set, remove, or clear operation.
     * The event is log-only and last-wins; each entry retains source and scope attribution.
     * @param data - complete post-change directive state.
     */
    'directive/change': DirectiveChange
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionDirectives: SessionDirectivesProjection
  }
  interface SessionProjectionMap {
    /** Complete active directive state from the latest `directive/change` event. */
    sessionDirectives: SessionDirectivesProjection
  }
}
