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

  it('drops a snapshot whose only section is the memory catalog', () => {
    const message = createUserMessage({
      content: [{ type: 'text', text: 'CATALOG_SECRET' }],
      source: {
        kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot',
        sections: [{ name: 'memory:catalog', text: 'CATALOG_SECRET' }],
      },
    })
    expect(projectMemoryArchive([message])).toEqual([])
  })
})
