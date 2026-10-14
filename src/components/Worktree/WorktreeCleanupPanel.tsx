import { Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  CONSENT_CLEANUP_BLOCKERS,
  HARD_CLEANUP_BLOCKERS,
  type WorktreeCleanupBlocker,
  type WorktreeCleanupCandidate,
  type WorktreeCleanupContext,
  type WorktreeCleanupReason
} from '../../../shared/types/worktree-cleanup'
import { useTerminalStore } from '../../store/terminal.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { useWorktreeStore } from '../../store/worktree.store'
import { deriveStatusTone } from '../../utils/paneDisplay'
import { Button } from '../../ui'

const REASON_LABEL: Record<WorktreeCleanupReason, string> = {
  'idle-clean': 'idle for 30+ days',
  merged: 'already merged',
  'missing-directory': 'folder missing'
}

const BLOCKER_LABEL: Record<WorktreeCleanupBlocker, string> = {
  locked: 'locked (git lock)',
  'git-status-error': 'git status unreadable',
  'dirty-files': 'uncommitted changes',
  'unpushed-commits': 'unpushed commits',
  'unknown-base': 'unknown base',
  'active-workspace': 'active pane',
  'running-terminal': 'terminal running',
  'live-agent': 'agent working'
}

function relativeAge(at: number | null): string {
  if (at === null) return 'activity unknown'
  const days = Math.floor((Date.now() - at) / 86_400_000)
  if (days < 1) return 'active today'
  return `idle for ${days} ${days === 1 ? 'day' : 'days'}`
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
  }
  return context
}

export function WorktreeCleanupPanel({ workspaceId, rootPath }: { workspaceId: string; rootPath: string }): ReactElement {
  const refresh = useWorktreeStore((s) => s.refresh)
  const [candidates, setCandidates] = useState<WorktreeCleanupCandidate[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const scan = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const found = await window.oxe.github.scanWorktreeCleanup({ rootPath, context: collectContext(workspaceId, rootPath) })
      setCandidates(found)
      setSelected(new Set(found.filter((c) => c.selectedByDefault).map((c) => c.path)))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
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
    setBusy(true)
    setMessage(null)
    try {
      const results = await window.oxe.github.removeWorktreeCleanup({
        rootPath,
        context: collectContext(workspaceId, rootPath),
        // Choosing a row that carries unsaved work is the explicit consent.
        targets: chosen.map((c) => ({ path: c.path, force: c.blockers.some((b) => CONSENT_CLEANUP_BLOCKERS.includes(b)) }))
      })
      const failed = results.filter((r) => !r.ok)
      setMessage(
        failed.length === 0
          ? `${results.length} worktree(s) removido(s).`
          : `${results.length - failed.length} removido(s); ${failed.length} recusado(s): ${failed.map((f) => f.message).join(' ')}`
      )
      await refresh(workspaceId, rootPath)
      await scan()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="worktree-remove-confirm" role="group" aria-label="Limpeza de worktrees">
      <div className="worktree-remove-confirm-head">
        <Trash2 size={12} aria-hidden="true" />
        <strong>Limpeza de worktrees</strong>
      </div>
      {candidates === null ? (
        <p className="worktree-remove-confirm-body">Scanning…</p>
      ) : candidates.length === 0 ? (
        <p className="worktree-remove-confirm-body">No worktree besides the main one.</p>
      ) : (
        <ul className="worktree-remove-confirm-body" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {candidates.map((c) => {
            const hard = c.blockers.some((b) => HARD_CLEANUP_BLOCKERS.includes(b))
            return (
              <li key={c.path} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={selected.has(c.path)}
                  disabled={hard || busy}
                  onChange={() => toggle(c)}
                  aria-label={`Selecionar ${c.branch ?? c.path}`}
                />
                <span>
                  <strong>{c.branch ?? '(detached)'}</strong> — {relativeAge(c.lastActivityAt)}
                  <br />
                  <small>
                    {c.reasons.length > 0 ? c.reasons.map((r) => REASON_LABEL[r]).join(', ') : 'no reason to remove'}
                    {c.blockers.length > 0 ? ` · ${c.blockers.map((b) => BLOCKER_LABEL[b]).join(', ')}` : ''}
                  </small>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {risky.length > 0 ? (
        <p className="worktree-remove-confirm-body" role="alert">
          {risky.length} selected worktree(s) have unsaved work or an unknown state; removing them discards that work.
        </p>
      ) : null}
      {message ? <p className="worktree-remove-confirm-body" role="status">{message}</p> : null}
      <div className="worktree-remove-confirm-actions">
        <Button variant="ghost" onClick={() => void scan()} disabled={busy}>Reanalisar</Button>
        <button
          type="button"
          className={risky.length > 0 ? 'danger-btn' : 'primary-btn'}
          onClick={() => void removeSelected()}
          disabled={busy || chosen.length === 0}
        >
          {busy ? 'Trabalhando…' : `Remove ${chosen.length} selected`}
        </button>
      </div>
    </div>
  )
}
