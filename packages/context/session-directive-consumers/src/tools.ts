/**
 * Model-facing controls for durable session directives.
 * @module @deepseek-ai/dsh-session-directive-consumers/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionDirective } from '@deepseek-ai/dsh-session-directives'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { directiveToolExecution, requireDirectiveMutationAuthority } from './authority.ts'

export const name = 'session-directive-tools'
export const inject = ['agents', 'sessionDirectives', 'tools']

const KEY = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u

interface DirectiveValue {
  readonly key: string
  readonly value: string
  readonly source: string
  readonly scope: string
}

function directiveValue(directive: SessionDirective): DirectiveValue {
  return { key: directive.key, value: directive.value, source: directive.source, scope: directive.scope }
}

function listValue(session: Session, ctx: Context): { directives: DirectiveValue[] } {
  return { directives: ctx.sessionDirectives.list(session).map(directiveValue) }
}

function renderValue(value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

function assertKey(key: string): void {
  if (!KEY.test(key)) throw new HarnessError('directive key has an invalid format', 'DIRECTIVE_TOOL_INVALID_KEY')
}

/** Register model-facing directive tools for one agent preset. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'list_directives',
    description: 'List persistent directives active in the calling session.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        directives: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          key: { type: 'string', required: true }, value: { type: 'string', required: true },
          source: { type: 'string', required: true }, scope: { type: 'string', required: true },
        } } },
      } },
      render: (_args, value) => renderValue(value),
    },
    execute(_args, exec) {
      const execution = directiveToolExecution(ctx, exec)
      return Promise.resolve(listValue(execution.agent.session, ctx))
    },
    presentCall: () => present('List session directives', 'read'),
  }))

  ctx.tools.register(defineTool({
    name: 'set_directive',
    description: 'Set one persistent session directive from the current direct top-level human request. Never infer persistence from one-turn or ambiguous wording.',
    parameters: {
      key: { type: 'string', required: true, description: 'Stable lowercase key using letters, digits, dots, underscores, or hyphens.' },
      value: { type: 'string', required: true, description: 'Directive text to apply to future responses in this session.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        key: { type: 'string', required: true }, value: { type: 'string', required: true },
        source: { type: 'string', required: true }, scope: { type: 'string', required: true },
      } },
      render: (_args, value) => renderValue(value),
    },
    execute(args, exec) {
      const execution = directiveToolExecution(ctx, exec)
      requireDirectiveMutationAuthority(ctx, execution, 'set')
      assertKey(args.key)
      return Promise.resolve(directiveValue(ctx.sessionDirectives.set(execution.agent.session, {
        key: args.key, value: args.value, source: 'model', scope: 'session',
      })))
    },
    presentCall: args => present('Set session directive', 'other', args.key),
  }))

  ctx.tools.register(defineTool({
    name: 'remove_directive',
    description: 'Remove one persistent directive by exact key. Mutation requires the current direct top-level human request.',
    parameters: { key: { type: 'string', required: true, description: 'Exact key returned by list_directives.' } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        key: { type: 'string', required: true }, removed: { type: 'boolean', required: true },
      } },
      render: (_args, value) => renderValue(value),
    },
    execute(args, exec) {
      const execution = directiveToolExecution(ctx, exec)
      requireDirectiveMutationAuthority(ctx, execution, 'remove')
      assertKey(args.key)
      return Promise.resolve({ key: args.key, removed: ctx.sessionDirectives.remove(execution.agent.session, args.key) })
    },
    presentCall: args => present('Remove session directive', 'other', args.key),
  }))
}
