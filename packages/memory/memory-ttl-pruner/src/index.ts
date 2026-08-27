/**
 * Recalled-memory TTL pruner. After a `recall_memory` result has been in the
 * model window for more than a configured number of steps, this service folds it
 * back to a short stub — appending the shadow-price `compaction/prune` event and
 * a `tool/result` replacement — so temporarily recalled context does not linger.
 * The original archive entry is untouched: the model can call `recall_memory`
 * again to re-expand it. Driven autonomously from `agent/pre-step`, independent
 * of compaction pressure.
 *
 * @module @deepseek-ai/dsh-memory-ttl-pruner
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { Session, ToolResultMessage } from '@deepseek-ai/dsh-session'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { RECALL_TOOL_NAME } from '@deepseek-ai/dsh-memory-core'
// Type-only: the `compaction/prune` shadow-price SessionEventMap merge.
import type {} from '@deepseek-ai/dsh-compaction'
// Type-only: the `ctx.tokenMeter` Context merge for the declared injection.
import type {} from '@deepseek-ai/dsh-token-meter'

declare module '@deepseek-ai/cordis' {
  interface Context {
    memoryTtlPruner: MemoryTtlPruner
  }
}

/** Text left in place of a folded-back recalled memory. */
const FOLD_STUB = '[Recalled memory folded back to free context. Call recall_memory again with the same tags to re-expand it.]'

/** Default steps a recalled result stays before it is folded back. */
const DEFAULT_RETAIN_STEPS = 2

/** Deployment policy for how long a recalled memory stays expanded in context. */
export interface MemoryTtlConfig {
  /**
   * Number of steps a `recall_memory` result remains verbatim before it is
   * folded back. `0` folds it before the very next step; larger values keep it
   * available across more steps. Counted by `step/start` events after the result.
   * Defaults to `2`.
   */
  retainSteps?: number
}

/** Folds aged-out recalled-memory results back to a stub on each pre-step. */
export class MemoryTtlPruner extends Service {
  // The token meter prices each folded node for its logged shadow-price event.
  static inject = ['tokenMeter']

  static Config: z<MemoryTtlConfig> = z.object({
    retainSteps: z.number().step(1).min(0).default(DEFAULT_RETAIN_STEPS),
  })

  /** Resolved retention window in steps. */
  readonly retainSteps: number

  constructor(ctx: Context, config: MemoryTtlConfig = {}) {
    super(ctx, 'memoryTtlPruner')
    this.retainSteps = config.retainSteps ?? DEFAULT_RETAIN_STEPS
    ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
      try {
        this.pruneSession(agent.session)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`memory TTL pruning failed: ${message}; continuing the turn`)
      }
      return next()
    })
  }

  /**
   * Fold every recalled-memory surface result older than {@link retainSteps}
   * back to a stub. A result is recalled when its call id belongs to a
   * `recall_memory` `tool/call`; its age is the count of `step/start` events
   * after it.
   * @param session - session whose current surface is rewritten.
   * @returns the number of results folded back.
   */
  pruneSession(session: Session): number {
    const recallCallIds = new Set<string>()
    const stepStartSeqs: number[] = []
    for (const event of session.events) {
      if (event.type === 'tool/call' && event.data.name === RECALL_TOOL_NAME) {
        recallCallIds.add(event.data.callId)
      } else if (event.type === 'step/start') {
        stepStartSeqs.push(event.seq)
      }
    }
    if (recallCallIds.size === 0) return 0

    let folded = 0
    for (const seq of [...session.surface.nodes]) {
      const event = session.events[seq]
      if (event?.type !== 'tool/result') continue
      if (!recallCallIds.has(event.data.message.source.callId)) continue
      const stepsSince = stepStartSeqs.reduce((count, start) => (start > seq ? count + 1 : count), 0)
      if (stepsSince <= this.retainSteps) continue

      const result = event.data.message.content[0]
      const stub = freezeMessage<ToolResultMessage>({
        ...event.data.message,
        content: [{ ...result, content: [{ type: 'text', text: FOLD_STUB }] }] as [typeof result],
      })
      // Shadow-price protocol: the metering event and its replacement are
      // appended synchronously adjacent, so a pure consumer subtracts the
      // folded node's heuristic price without retaining per-node state.
      session.append('compaction/prune', {
        shadowedRange: { start: seq, end: seq },
        shadowedSeqs: [seq],
        shadowedTokenCount: this.ctx.tokenMeter.estimateMessage(event.data.message),
      })
      session.append('tool/result', { ...event.data, message: stub }, {
        surfaceOp: { op: 'replace', start: seq, end: seq },
        sourceEventSeqs: [seq],
      })
      folded += 1
    }
    return folded
  }
}

export default MemoryTtlPruner
