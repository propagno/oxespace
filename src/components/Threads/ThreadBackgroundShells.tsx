import { useLayoutEffect, useState, type ReactElement } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ThreadBackgroundShell } from '../../../shared/types/ipc'
import { useThreadWorkbenchStore } from '../../store/thread-workbench.store'
import { Button, Spinner } from '../../ui'

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

  return (
    <section className="thread-background-shells" aria-label={t('backgroundShells.region')}>
      {shells.map(shell => (
        <article key={shell.id} className="thread-background-shell" data-state={shell.state}>
          <header className="thread-background-shell-header">
            <code className="thread-background-shell-command">{shell.command}</code>
            {shell.state === 'running' ? (
              <span className="thread-background-shell-state">
                <Spinner size="sm" decorative />
                {t('backgroundShells.running')}
              </span>
            ) : shell.state === 'stopped' ? (
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
          </header>
          {shell.tail.length > 0 && (
            <div className="thread-background-shell-tail">
              {shell.tail.slice(-5).map((line, index) => (
                <div key={index} className="thread-background-shell-line">{line}</div>
              ))}
            </div>
          )}
          <footer className="thread-background-shell-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (onShowOutput) onShowOutput(shell.id)
                else useThreadWorkbenchStore.getState().setView(threadId, { panel: 'background' })
              }}
            >
              {t('backgroundShells.showOutput')}
            </Button>
            {shell.canStop && shell.startedBy === 'oxespace' ? (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  void window.oxe?.background?.stop?.(shell.id)
                }}
              >
                {t('backgroundShells.stop')}
              </Button>
            ) : shell.startedBy === 'agent' && shell.state === 'running' ? (
              <small className="thread-background-shell-note">{t('backgroundShells.stopFromConversation')}</small>
            ) : null}
          </footer>
        </article>
      ))}
    </section>
  )
}
