import { useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionDirectiveEntry } from './types.ts'
import type { SessionDirectivesInjected } from './index.ts'
import css from './SessionDirectivesView.module.css'

export type SessionDirectivesViewProps = ConvViewProps & InjectFace<SessionDirectivesInjected> & PropsLocale<'sessionDirectives'>

type Draft = { key: string; value: string; editing: boolean }

/** Render and mutate the host-owned session directives projection. */
export function SessionDirectivesView({ useProjection, mutate, t }: SessionDirectivesViewProps) {
  const projection = useProjection('sessionDirectives')
  const entries = projection?.directives ?? []
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (operation: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const failure = await mutate(operation)
      if (failure !== null) setError(failure)
      else setDraft(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  const edit = (entry: SessionDirectiveEntry): void => setDraft({ key: entry.key, value: entry.value, editing: true })
  const save = (): void => {
    if (draft === null) return
    void run(`set ${draft.key} ${JSON.stringify(draft.value)}`)
  }

  return <section className={css.root} aria-label={t('title')}>
    <header className={css.header}><h2 className={css.title}>{t('title')}</h2><div className={css.actions}><button className={css.button} type="button" disabled={busy} onClick={() => setDraft({ key: '', value: '', editing: false })}>{t('add')}</button><button className={css.button} type="button" disabled={busy || entries.length === 0} onClick={() => void run('clear')}>{t('clear')}</button></div></header>
    {draft !== null && <div className={css.form}>
      <label className={css.field}>{t('key')}<input className={css.input} value={draft.key} disabled={busy || draft.editing} onChange={event => setDraft({ ...draft, key: event.target.value })} /></label>
      <label className={css.field}>{t('value')}<textarea className={css.textarea} value={draft.value} disabled={busy} onChange={event => setDraft({ ...draft, value: event.target.value })} /></label>
      <div className={css.actions}><button className={css.button} type="button" disabled={busy || draft.key.trim() === '' || draft.value.trim() === ''} onClick={save}>{busy ? t('saving') : t('save')}</button><button className={css.button} type="button" disabled={busy} onClick={() => setDraft(null)}>{t('cancel')}</button></div>
    </div>}
    {error !== null && <p className={css.error} role="status">{t('error')}: {error}</p>}
    {entries.length === 0 && draft === null && <p className={css.empty}>{t('empty')}</p>}
    <div className={css.list}>{entries.map(entry => <article className={css.card} key={entry.key}>
      <div className={css.row}><span className={css.key}>{entry.key}</span><span className={css.meta}>{t('scope.session')} · {entry.source}</span></div>
      <p className={css.value}>{entry.value}</p>
      <div className={css.actions}><button className={css.button} type="button" disabled={busy} onClick={() => edit(entry)}>{t('edit')}</button><button className={css.button} type="button" disabled={busy} onClick={() => void run(`delete ${entry.key}`)}>{t('delete')}</button></div>
    </article>)}</div>
  </section>
}
