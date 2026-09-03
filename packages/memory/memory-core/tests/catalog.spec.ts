import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { projectMemoryArchive } from '../src/catalog.ts'

describe('memory archive projection', () => {
  it('removes only the catalog section from aggregate runtime context', () => {
    const message = createUserMessage({
      content: [{ type: 'text', text: 'aggregate contains a catalog marker' }],
      source: {
        kind: 'plugin',
        plugin: '@deepseek-ai/dsh-system-prompt',
        form: 'snapshot',
        sections: [
          { name: 'memory:catalog', text: 'CATALOG_SECRET' },
          { name: 'workspace:policy', text: 'Workspace is writable.' },
        ],
      },
    })

    const [projected] = projectMemoryArchive([message])
    expect(projected?.source).toMatchObject({
      form: 'snapshot',
      sections: [{ name: 'workspace:policy', text: 'Workspace is writable.' }],
    })
    expect(projected?.content).toEqual([{
      type: 'text',
      text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nWorkspace is writable.',
    }])
  })

  it.each([
    ['memory:catalog', 'CATALOG_SECRET'],
    ['session:directives', 'Always answer concisely.'],
  ])('drops a snapshot whose only section is %s', (name, text) => {
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot',
        sections: [{ name, text }],
      },
    })
    expect(projectMemoryArchive([message])).toEqual([])
  })

  it('removes directives and catalog while preserving episodic context', () => {
    const message = createUserMessage({
      content: [{ type: 'text', text: 'aggregate' }],
      source: {
        kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot',
        sections: [
          { name: 'session:directives', text: 'Always answer concisely.' },
          { name: 'memory:catalog', text: 'CATALOG_SECRET' },
          { name: 'workspace:notice', text: 'Build completed.' },
        ],
      },
    })

    const [projected] = projectMemoryArchive([message])
    expect(projected?.source).toMatchObject({
      form: 'snapshot',
      sections: [{ name: 'workspace:notice', text: 'Build completed.' }],
    })
    expect(projected?.content).toEqual([{
      type: 'text',
      text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\nBuild completed.',
    }])
  })
})
