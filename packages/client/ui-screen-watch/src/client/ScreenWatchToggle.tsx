/**
 * Screen watch toggle: occupies one seat in the composer tool row
 * (`conversation.input.right`, left of the send button).
 *
 * ON means:
 *  - every N minutes a screenshot + one-line analysis request is queued into
 *    this conversation (background awareness);
 *  - a question referencing the screen attaches the screenshot to the SAME
 *    message: the submit gesture (Enter, or the primary button click) is
 *    intercepted while the draft mentions the screen, the screenshot is
 *    pasted into the composer draft through its own paste-intake path, then
 *    the blocked submission is re-issued with the image in place.
 *
 * Capture runs through getDisplayMedia; inside DeskDSH the shell answers that
 * request with the primary screen (no picker), while a plain browser falls
 * back to the system picker and the toggle stays disabled.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { captureScreen, captureScreenFile, findWatcherChildId, runningInsideDeskDsh, sendPrompt, sendToWatcher } from './capture.ts'
import { getCommandsRemote } from './index.ts'
import css from './ScreenWatchToggle.module.css'

/** Full props for the input.right seat: runtime kit + the InputZone owner share. */
type ToggleProps = PropsRuntime<'conversation.input.right'>

const WATCH_NOTE = '请用一两句话简要记录当前屏幕显示的内容和正在进行的活动（这是后台看屏记录，无需展开回答）。'
const ATTACH_NOTE = '附图：上一条消息提到的屏幕内容截图，供你参考。'
const SCREEN_HINTS = ['屏幕', '页面', '窗口', '界面', '画面', '图里', '这张图', '上面写的', '报错', '截个图', '截一下', '帮我截图', '拍一下屏幕', '看看屏幕']
const STORAGE_PREFIX = 'dsh.screenwatch.'
const INTERVAL_CHOICES = [1, 5, 10, 30] as const

interface WatchPrefs { enabled: boolean; intervalMin: number }

function loadPrefs(sessionId: string): WatchPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sessionId)
    if (raw) return { enabled: false, intervalMin: 5, ...JSON.parse(raw) }
  } catch {}
  return { enabled: false, intervalMin: 5 }
}

function savePrefs(sessionId: string, prefs: WatchPrefs): void {
  try { localStorage.setItem(STORAGE_PREFIX + sessionId, JSON.stringify(prefs)) } catch {}
}

/** Walk up from an element to the nearest ancestor that hosts the composer textarea. */
function findComposerRoot(from: HTMLElement | null): HTMLElement | null {
  let node = from?.parentElement ?? null
  while (node !== null) {
    if (node.querySelector('textarea') !== null) return node
    node = node.parentElement
  }
  return null
}

export function ScreenWatchToggle({ sessionId, useInput, useSession, inputActions }: ToggleProps) {
  const [prefs, setPrefs] = useState<WatchPrefs>(() => loadPrefs(sessionId))
  const [menuOpen, setMenuOpen] = useState(false)
  const [lastShotAt, setLastShotAt] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const attachInFlight = useRef(false)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const insideDeskDsh = runningInsideDeskDsh()
  const enabled = prefs.enabled

  const input = useInput(state => state)
  const running = useSession(state => state?.running === true)
  // Subagent (child) conversations never get their own toggle: watching is
  // owned by the parent conversation's loop; a toggle here would feed a
  // nonexistent grandchild watcher.
  const isSubagentSession = useSession(state => state?.subagent != null)
  const lastPlainDraft = useRef('')
  const prevPhase = useRef(input.phase)

  const setPref = useCallback((patch: Partial<WatchPrefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch }
      savePrefs(sessionId, next)
      return next
    })
  }, [sessionId])

  // Cross-window sync: every DeskDSH window (mini chat, full window, browser
  // tabs) runs its own timers off its own React state. Without this, disabling
  // the toggle in one window leaves the others capturing forever.
  useEffect(() => {
    const key = STORAGE_PREFIX + sessionId
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== key || event.storageArea !== localStorage) return
      setPrefs(loadPrefs(sessionId))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [sessionId])

  // ---- periodic watch loop ------------------------------------------------
  const captureAndSend = useCallback(async (note: string): Promise<boolean> => {
    if (busy.current) return false
    busy.current = true
    try {
      const image = await captureScreen()
      await sendPrompt(sessionId, note, image)
      setLastShotAt(Date.now())
      setError(null)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      busy.current = false
    }
  }, [sessionId])

  // Set by the toggle's onClick when turning ON; consumed by the periodic
  // effect to fire one quick first shot. Distinguishes a genuine enable from
  // a remount (this component unmounts on every session switch — without
  // this, revisiting the conversation would trigger an extra screenshot).
  const immediateShotRequested = useRef(false)

  // Ask the host to (re)use the watcher subagent. Invoked ONLY from the
  // toggle's onClick — never from an effect: this component unmounts on every
  // session switch, and an effect keyed on `enabled` would re-fire the
  // command each time the conversation is revisited.
  const startWatcher = useCallback((): void => {
    const commands = getCommandsRemote()
    if (commands === undefined) {
      setError('commands remote 不可用')
      return
    }
    void commands.execute(sessionId, '/screenwatch start', []).then((outcome) => {
      if (!outcome.ok) {
        setError(`${outcome.error.code}: ${outcome.error.message}`)
        return
      }
      if (outcome.value === undefined) {
        setError('host 上未注册 /screenwatch 命令（需要带 screen-watch 插件的 host）')
        return
      }
      if (outcome.value.result.kind === 'error') setError(outcome.value.result.text)
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
    })
  }, [sessionId])

  // Periodic loop: screenshot -> feed the watcher child (never the main
  // conversation). Cross-window leader election via Web Locks: every open page
  // (mini chat, full window, browser tabs) mounts with enabled=true from
  // localStorage, so without a single leader each window would run its own
  // interval and the watcher would receive N screenshots per period. The lock
  // holder runs the loop; others poll and take over when it closes.
  useEffect(() => {
    if (!enabled || isSubagentSession) return
    let cancelled = false
    if (!('locks' in navigator)) {
      // No Web Locks (unexpected browser): fall back to plain loop.
      return runPlainLoop()
    }
    let releaseLeader: (() => void) | undefined
    let retryTimer: number | undefined
    const lockName = `dsh-screenwatch:${sessionId}`
    const tryLead = (): void => {
      if (cancelled) return
      void navigator.locks.request(lockName, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          // Another window is the leader; check again later for takeover.
          retryTimer = window.setTimeout(tryLead, 30_000)
          return
        }
        const stop = runPlainLoop()
        // Hold the lock until disabled/unmounted; releasing lets a waiting
        // window take over immediately.
        return new Promise<void>((resolve) => {
          releaseLeader = () => { stop(); resolve() }
        })
      }).catch(() => {
        if (!cancelled) retryTimer = window.setTimeout(tryLead, 30_000)
      })
    }
    tryLead()
    return () => {
      cancelled = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      releaseLeader?.()
    }

    function runPlainLoop(): () => void {
      let stopped = false
      const tick = (): void => {
        if (stopped || cancelled || busy.current) return
        busy.current = true
        void (async () => {
          try {
            const image = await captureScreen()
            const childId = await findWatcherChildId(sessionId)
            if (stopped || cancelled) return
            if (childId === null) {
              setError('看屏子代理未就绪（可关闭开关重新开启，或先发送 /screenwatch start）')
              return
            }
            await sendToWatcher(sessionId, childId, WATCH_NOTE, image)
            setLastShotAt(Date.now())
            setError(null)
          } catch (e) {
            if (!stopped && !cancelled) setError(e instanceof Error ? e.message : String(e))
          } finally {
            busy.current = false
          }
        })()
      }
      // Quick first shot only right after a manual enable (the spawn needs a
      // moment to settle); plain remounts wait for the normal interval.
      const firstDelay = immediateShotRequested.current ? 4000 : prefs.intervalMin * 60_000
      immediateShotRequested.current = false
      const first = window.setTimeout(tick, firstDelay)
      const timer = window.setInterval(tick, prefs.intervalMin * 60_000)
      return () => { stopped = true; window.clearTimeout(first); window.clearInterval(timer) }
    }
  }, [enabled, isSubagentSession, prefs.intervalMin, sessionId])

  // ---- same-message attach: intercept the submit gesture ------------------
  const draftMentionsScreen = useCallback((draft: string): boolean =>
    draft.length > 0 && SCREEN_HINTS.some(hint => draft.includes(hint)), [])

  const attachAndSubmit = useCallback(async (composerRoot: HTMLElement): Promise<void> => {
    attachInFlight.current = true
    try {
      const file = await captureScreenFile()
      const textarea = composerRoot.querySelector('textarea')
      if (textarea === null) throw new Error('composer textarea not found')
      const data = new DataTransfer()
      data.items.add(file)
      const pasted = textarea.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }))
      if (!pasted) throw new Error('paste intake refused')
      // Let the paste intake commit the draft image, then send.
      await new Promise(resolve => setTimeout(resolve, 80))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    // Always release the blocked submission (text-only if attach failed).
    // The guard stays up across the re-issued submit so the phase-watch
    // fallback does NOT fire a duplicate follow-up screenshot message.
    submitRef.current?.()
    window.setTimeout(() => { attachInFlight.current = false }, 1500)
  }, [])

  // inputActions identity: keep the latest submit in a ref so the async
  // attach flow can release the blocked gesture afterwards.
  const submitRef = useRef<(() => void) | null>(null)
  submitRef.current = inputActions === undefined ? null : () => inputActions.submit()

  useEffect(() => {
    if (isSubagentSession) return
    const root = findComposerRoot(buttonRef.current)
    if (root === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!enabled || attachInFlight.current) return
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.repeat) return
      const target = event.target
      if (!(target instanceof HTMLTextAreaElement)) return
      if (!draftMentionsScreen(lastPlainDraft.current)) return
      if (input.phase !== 'plain') return
      event.preventDefault()
      event.stopPropagation()
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
      void attachAndSubmit(root)
    }
    const onClick = (event: MouseEvent): void => {
      if (!enabled || attachInFlight.current || running) return
      const target = event.target
      if (!(target instanceof Element)) return
      const button = target.closest('button')
      if (button === null || button === buttonRef.current) return
      const row = buttonRef.current?.parentElement
      if (row === null || row === undefined || !row.contains(button)) return
      if (button.disabled) return
      if (!draftMentionsScreen(lastPlainDraft.current)) return
      if (input.phase !== 'plain') return
      event.preventDefault()
      event.stopPropagation()
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
      void attachAndSubmit(root)
    }
    root.addEventListener('keydown', onKeyDown, true)
    root.addEventListener('click', onClick, true)
    return () => {
      root.removeEventListener('keydown', onKeyDown, true)
      root.removeEventListener('click', onClick, true)
    }
  }, [enabled, isSubagentSession, running, input.phase, draftMentionsScreen, attachAndSubmit])

  // ---- fallback: follow-up message when a gesture slipped through ---------
  useEffect(() => {
    if (isSubagentSession) return
    if (input.phase === 'plain' || input.phase === 'adjudicating') {
      if (input.draft) lastPlainDraft.current = input.draft
    }
    const startedSubmitting = input.phase === 'submitting' && prevPhase.current !== 'submitting'
    prevPhase.current = input.phase
    if (!startedSubmitting) return
    if (attachInFlight.current) return
    const question = lastPlainDraft.current
    if (enabled && question && SCREEN_HINTS.some(hint => question.includes(hint))) {
      void captureAndSend(ATTACH_NOTE)
    }
  }, [input, enabled, isSubagentSession, captureAndSend])

  if (isSubagentSession) return null

  const title = !insideDeskDsh
    ? '看屏：需要在 DeskDSH 客户端的窗口中开启（浏览器无法静默截图）'
    : enabled
      ? `看屏已开启：每 ${prefs.intervalMin} 分钟截图记录${lastShotAt ? `，上次 ${new Date(lastShotAt).toLocaleTimeString()}` : ''}${error ? `，最近失败：${error}` : ''}`
      : '看屏：开启后定时截图分析，提问涉及屏幕内容时自动附图'

  return (
    <span className={css.wrap}>
      <button
        ref={buttonRef}
        type="button"
        className={`${css.toggle}${enabled ? ` ${css.on}` : ''}`}
        disabled={!insideDeskDsh}
        title={title}
        aria-pressed={enabled}
        onClick={() => {
          const next = !enabled
          setPref({ enabled: next })
          if (next) {
            immediateShotRequested.current = true
            startWatcher()
          }
        }}
      >
        👁{enabled ? <span className={css.dot} /> : null}
      </button>
      <button
        type="button"
        className={css.caret}
        title="看屏间隔"
        aria-label="看屏间隔"
        disabled={!insideDeskDsh}
        onClick={() => setMenuOpen(open => !open)}
      >
        ▾
      </button>
      {menuOpen ? (
        <span className={css.menu} role="menu">
          {INTERVAL_CHOICES.map(minutes => (
            <button
              key={minutes}
              type="button"
              role="menuitem"
              className={minutes === prefs.intervalMin ? css.menuItemActive : css.menuItem}
              onClick={() => { setPref({ intervalMin: minutes }); setMenuOpen(false) }}
            >
              每 {minutes} 分钟
            </button>
          ))}
        </span>
      ) : null}
    </span>
  )
}
