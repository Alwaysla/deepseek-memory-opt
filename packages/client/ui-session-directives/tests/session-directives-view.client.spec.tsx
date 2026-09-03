// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en } from '../src/client/locales.ts'
import { SessionDirectivesView, type SessionDirectivesViewProps } from '../src/client/SessionDirectivesView.tsx'

afterEach(cleanup)

function setup() {
  const store = createSnapshotStore({
    value: { directives: [{ key: 'tone', value: 'Be concise', source: 'automatic', scope: 'session' as const }] },
  })
  const mutate = vi.fn(() => Promise.resolve<string | null>(null))
  const useProjection = (_key: string, selector?: (value: unknown) => unknown) => (
    bindSnapshotSelector(store)(state => (selector ?? (value => value))(state.value))
  )
  const props = { useProjection, mutate, t: makeTranslate(en) } as unknown as SessionDirectivesViewProps
  render(<SessionDirectivesView {...props} />)
  return { mutate }
}

describe('SessionDirectivesView', () => {
  it('renders projected session entries and removes one by key', async () => {
    const { mutate } = setup()
    expect(screen.getByText('Be concise')).toBeTruthy()
    expect(screen.getByText('Session · automatic')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('delete tone'))
  })

  it('keeps the stable key immutable while editing', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Key')).toHaveProperty('disabled', true)
  })

  it('sets a directive with a JSON string value', async () => {
    const { mutate } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add directive' }))
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'format' } })
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'Use bullets' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('set format "Use bullets"'))
  })
})
