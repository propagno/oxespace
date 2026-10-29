import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CONSENT_CLEANUP_BLOCKERS,
  HARD_CLEANUP_BLOCKERS,
  type WorktreeCleanupCandidate,
  type WorktreeCleanupContext
} from '../../../shared/types/worktree-cleanup'
import { i18n } from '../../i18n'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { useWorktreeStore } from '../../store/worktree.store'
import { deriveStatusTone } from '../../utils/paneDisplay'
import { Button, ConfirmDialog, EmptyState, ErrorState, LoadingState } from '../../ui'
import { humanizeError } from '../../utils/humanizeError'

/** "idle for 3 days", "active today", in the interface language. */
export function relativeAge(at: number | null, now = Date.now()): string {
  if (at === null) return i18n.t('worktree.cleanup.activityUnknown', { ns: 'code' })
  const days = Math.floor((now - at) / 86_400_000)
  if (days < 1) return i18n.t('worktree.cleanup.activeToday', { ns: 'code' })
  return i18n.t('worktree.cleanup.idleDays', { ns: 'code', count: days })
}

/** Collects what only the renderer knows: open panes, shells and agents, by path. */
function collectContext(workspaceId: string, rootPath: string): WorktreeCleanupContext {
  const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  const { panes: terminals, activePaneId } = useTerminalStore.getState()
  const context: WorktreeCleanupContext = { activePaths: [], runningTerminalPaths: [], liveAgentPaths: [] }
  for (const pane of workspace?.panes ?? []) {
    if (pane.type !== 'terminal') continue
    const path = pane.rootPath ?? rootPath
    if (pane.id === activePaneId) context.activePaths.push(path)
    const entry = terminals[pane.id]
    if (!entry) continue
    if (entry.status === 'running') context.runningTerminalPaths.push(path)
    if (deriveStatusTone(entry) === 'thinking') context.liveAgentPaths.push(path)
    // An agent that moved into another worktree is using that one: it must not be offered for removal.
    const moved = entry.location?.sameRepository ? entry.location.checkoutRoot : null
    if (moved) { context.activePaths.push(moved); if (entry.status === 'running') context.liveAgentPaths.push(moved) }
  }
  return context
}

export function WorktreeCleanupPanel({ workspaceId, rootPath }: { workspaceId: string; rootPath: string }): ReactElement {
  const { t } = useTranslation('code')
  const refresh = useWorktreeStore((s) => s.refresh)
  const [candidates, setCandidates] = useState<WorktreeCleanupCandidate[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const scan = useCallback(async (): Promise<void> => {
    setBusy(true)
    setScanError(null)
    try {
      const found = await window.oxe.github.scanWorktreeCleanup({ rootPath, context: collectContext(workspaceId, rootPath) })
      setCandidates(found)
      setSelected(new Set(found.filter((c) => c.selectedByDefault).map((c) => c.path)))
    } catch (error) {
      setScanError(humanizeError(error))
    } finally {
      setBusy(false)
    }
  }, [rootPath, workspaceId])

  useEffect(() => { void scan() }, [scan])

  const chosen = useMemo(() => (candidates ?? []).filter((c) => selected.has(c.path)), [candidates, selected])
  const risky = chosen.filter((c) => c.blockers.some((b) => CONSENT_CLEANUP_BLOCKERS.includes(b)))

  const toggle = (candidate: WorktreeCleanupCandidate): void => {
    if (candidate.blockers.some((b) => HARD_CLEANUP_BLOCKERS.includes(b))) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(candidate.path)) next.delete(candidate.path)
      else next.add(candidate.path)
      return next
    })
  }

  const removeSelected = async (): Promise<void> => {
    setConfirming(false)
    setBusy(true)
    setMessage(null)
    try {
      const results = await window.oxe.github.removeWorktreeCleanup({
        rootPath,
        context: collectContext(workspaceId, rootPath),
        // Confirming the removal of a row that carries unsaved work is the explicit consent.
        targets: chosen.map((c) => ({ path: c.path, force: c.blockers.some((b) => CONSENT_CLEANUP_BLOCKERS.includes(b)) }))
      })
      const failed = results.filter((r) => !r.ok)
      setMessage(
        failed.length === 0
          ? t('worktree.cleanup.removed', { count: results.length })
          : `${t('worktree.cleanup.partly', { removed: results.length - failed.length, count: failed.length })} ${failed.map((f) => f.message).join(' ')}`
      )
      await refresh(workspaceId, rootPath)
      await scan()
    } catch (error) {
      setMessage(humanizeError(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="worktree-remove-confirm" role="group" aria-label={t('worktree.cleanup.title')}>
      <div className="worktree-remove-confirm-head">
        <Trash2 size={12} aria-hidden="true" />
        <strong>{t('worktree.cleanup.title')}</strong>
      </div>
      {scanError ? (
        <ErrorState compact title={t('worktree.cleanup.scanFailed')} message={scanError} onRetry={() => void scan()} />
      ) : candidates === null ? (
        <LoadingState label={t('worktree.cleanup.scanning')} />
      ) : candidates.length === 0 ? (
        <EmptyState compact title={t('worktree.cleanup.none')} />
      ) : (
        <ul className="worktree-remove-confirm-body" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {candidates.map((c) => {
            const hard = c.blockers.some((b) => HARD_CLEANUP_BLOCKERS.includes(b))
            const name = c.branch ?? t('worktree.detached')
            return (
              <li key={c.path} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={selected.has(c.path)}
                  disabled={hard || busy}
                  onChange={() => toggle(c)}
                  aria-label={t('worktree.cleanup.select', { name })}
                />
                <span>
                  <strong>{name}</strong> — {relativeAge(c.lastActivityAt)}
                  <br />
                  <small>
                    {c.reasons.length > 0 ? c.reasons.map((r) => t(`worktree.cleanup.reason.${r}`)).join(', ') : t('worktree.cleanup.noReason')}
                    {c.blockers.length > 0 ? ` · ${c.blockers.map((b) => t(`worktree.cleanup.blocker.${b}`)).join(', ')}` : ''}
                  </small>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {risky.length > 0 ? (
        <p className="worktree-remove-confirm-body" role="alert">{t('worktree.cleanup.risky', { count: risky.length })}</p>
      ) : null}
      {message ? <p className="worktree-remove-confirm-body" role="status">{message}</p> : null}
      <div className="worktree-remove-confirm-actions">
        <Button variant="ghost" onClick={() => void scan()} disabled={busy}>{t('worktree.cleanup.rescan')}</Button>
        <Button
          variant={risky.length > 0 ? 'danger' : 'primary'}
          onClick={() => { if (risky.length > 0) setConfirming(true); else void removeSelected() }}
          disabled={busy || chosen.length === 0}
          loading={busy && candidates !== null}
        >
          {t('worktree.cleanup.remove', { count: chosen.length })}
        </Button>
      </div>
      {confirming ? (
        <ConfirmDialog
          danger
          title={t('worktree.cleanup.confirmTitle', { count: risky.length })}
          description={t('worktree.cleanup.confirmBody', { names: risky.map((c) => c.branch ?? c.path).join(', ') })}
          confirmLabel={t('worktree.cleanup.confirm', { count: chosen.length })}
          onConfirm={() => void removeSelected()}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </div>
  )
}
