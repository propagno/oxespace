import { useLayoutEffect, useState, type ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ThreadBackgroundShell } from '../../../shared/types/ipc'
import { useThreadWorkbenchStore } from '../../store/thread-workbench.store'
import { Button, Spinner } from '../../ui'

/** How many finished shells stay in view; the rest open with Show earlier. */
const FINISHED_SHOWN = 2

function formatHHMM(since: number): string {
  const date = new Date(since)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function ThreadBackgroundShells(props: {
  threadId: string
  onShowOutput?: (shellId: string) => void
}): ReactElement | null {
  const { threadId, onShowOutput } = props
  const { t } = useTranslation('thread')
  const [shells, setShells] = useState<ThreadBackgroundShell[]>([])
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState(false)

  useLayoutEffect(() => {
    let cancelled = false
    const api = window.oxe?.thread

    const load = (): void => {
      if (!api?.background) return
      try {
        void api.background(threadId).then(result => {
          if (!cancelled && Array.isArray(result)) {
            flushSync(() => setShells(result))
          }
        }).catch(() => {
          // Ignore transient IPC read errors.
        })
      } catch {
        // Ignore synchronous mock errors.
      }
    }

    load()
    const unsubscribe = api?.onBackgroundChanged?.(event => {
      if (!event?.threadId || event.threadId === threadId) {
        load()
      }
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [threadId])

  if (shells.length === 0) return null

  // A live shell keeps its full card; a finished one shrinks to one line, and only the latest two stay in view (the
  // rest behind Show earlier), so a long session's finished commands never cover the conversation (1.5.0, user report
  // 13/11). Each shell keeps one card for its whole life, so a shell that stops updates in place.
  const finishedIds = shells.filter(shell => shell.state === 'stopped').map(shell => shell.id)
  const shownFinished = new Set(showAll ? finishedIds : finishedIds.slice(-FINISHED_SHOWN))
  const hiddenCount = finishedIds.length - shownFinished.size
  const visible = shells.filter(shell => shell.state !== 'stopped' || shownFinished.has(shell.id))
  const opensPanel = (shell: ThreadBackgroundShell): boolean => !onShowOutput && shell.startedBy === 'oxespace' && shell.state === 'running'
  const showOutput = (shell: ThreadBackgroundShell): void => {
    if (onShowOutput) onShowOutput(shell.id)
    else if (opensPanel(shell)) useThreadWorkbenchStore.getState().setView(threadId, { panel: 'background' })
    else setOpen(current => ({ ...current, [shell.id]: !current[shell.id] }))
  }

  return (
    <section className="thread-background-shells" aria-label={t('backgroundShells.region')}>
      {hiddenCount > 0 && (
        <button type="button" className="thread-background-more" onClick={() => setShowAll(true)}>{t('backgroundShells.showEarlier', { count: hiddenCount })}</button>
      )}
      {visible.map(shell => {
        const finished = shell.state === 'stopped'
        const expanded = finished ? Boolean(open[shell.id]) : true
        return (
          <article key={shell.id} className={finished ? 'thread-background-shell is-finished' : 'thread-background-shell'} data-state={shell.state}>
            <header className="thread-background-shell-header">
              <code className="thread-background-shell-command" title={shell.command}>{shell.command}</code>
              {shell.state === 'running' ? (
                <span className="thread-background-shell-state">
                  <Spinner size="sm" decorative />
                  {t('backgroundShells.running')}
                </span>
              ) : finished ? (
                <span className="thread-background-shell-state">
                  <span>{t('backgroundShells.stopped')}</span>
                  {' · '}
                  <span>{t('backgroundShells.exitCode', { code: shell.exitCode ?? 0 })}</span>
                </span>
              ) : (
                <span className="thread-background-shell-state">
                  {t('backgroundShells.unknownSince', { time: formatHHMM(shell.since) })}
                </span>
              )}
              {finished && shell.tail.length > 0 && (
                <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => showOutput(shell)}>
                  {expanded ? t('backgroundShells.hideOutput') : t('backgroundShells.showOutput')}
                </Button>
              )}
            </header>
            {expanded && shell.tail.length > 0 && (
              <div className="thread-background-shell-tail">
                {shell.tail.slice(-5).map((line, index) => <div key={index} className="thread-background-shell-line">{line}</div>)}
              </div>
            )}
            {!finished && (
              <footer className="thread-background-shell-actions">
                <Button size="sm" variant="ghost" onClick={() => showOutput(shell)}>
                  {t('backgroundShells.showOutput')}
                </Button>
                {shell.canStop && shell.startedBy === 'oxespace' ? (
                  <Button size="sm" variant="danger" onClick={() => { void window.oxe?.background?.stop?.(shell.id) }}>
                    {t('backgroundShells.stop')}
                  </Button>
                ) : shell.startedBy === 'agent' && shell.state === 'running' ? (
                  <small className="thread-background-shell-note">{t('backgroundShells.stopFromConversation')}</small>
                ) : null}
              </footer>
            )}
          </article>
        )
      })}
      {showAll && finishedIds.length > FINISHED_SHOWN && (
        <button type="button" className="thread-background-more" onClick={() => setShowAll(false)}>{t('backgroundShells.showFewer')}</button>
      )}
    </section>
  )
}
