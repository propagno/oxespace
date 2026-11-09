import { useCallback, useEffect, useId, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { messageFromError, type MainMessage } from '../../../shared/messages'
import { currentLanguage, i18n } from '../../i18n'
import { formatMainMessage } from '../../i18n/mainMessage'
import { Button, ConfirmDialog, EmptyState, ErrorState, LoadingState, Notice } from '../../ui'
import { Badge } from '../../ui/Display'
import { Checkbox } from '../../ui/Field'
import { toast } from '../../ui/Toast'
import { humanizeError } from '../../utils/humanizeError'
import './WorktreesPanel.css'

/** One worktree as main lists it (BACKEND #704 §A63), merged first then oldest first. */
interface WorktreeRow {
  path: string
  branch: string | null
  conversation: { id: string; title: string; gone: boolean } | null
  merged: { by: 'provider' | 'git'; value: boolean }
  prNumber: number | null
  changed: number
  diskBytes: number
  lastActivity: number | null
  branchChanged: boolean
  locked?: boolean
  missing?: boolean
}

interface RemoveInput { rootPath: string; path: string; deleteBranch: boolean; confirmUnmerged?: boolean }
type RemoveResult = { ok: true; branchDeleted: boolean } | { ok: false; refusal: { code: string; params: Record<string, unknown> } }
interface PanelApi {
  list(input: { rootPath: string }): Promise<WorktreeRow[]>
  remove(input: RemoveInput): Promise<RemoveResult>
}

/** The panel's two calls: `window.oxe.worktreesPanel` when the bridge has it, else the same channels under `github`. */
function panelApi(): PanelApi {
  const direct = (window.oxe as unknown as { worktreesPanel?: PanelApi }).worktreesPanel
  if (direct) return direct
  return {
    list: input => window.oxe.github.listWorktreesPanel(input) as Promise<WorktreeRow[]>,
    remove: input => window.oxe.github.removeWorktreePanel(input) as Promise<RemoveResult>
  }
}

/** "idle for 3 days", "active today", in the interface language. */
export function relativeAge(at: number | null, now = Date.now()): string {
  if (at === null) return i18n.t('worktree.cleanup.activityUnknown', { ns: 'code' })
  const days = Math.floor((now - at) / 86_400_000)
  if (days < 1) return i18n.t('worktree.cleanup.activeToday', { ns: 'code' })
  return i18n.t('worktree.cleanup.idleDays', { ns: 'code', count: days })
}

function diskText(bytes: number): string {
  const megabytes = bytes / 1_000_000
  return new Intl.NumberFormat(currentLanguage(), { style: 'unit', unit: 'megabyte', maximumFractionDigits: megabytes < 10 ? 1 : 0 }).format(megabytes)
}

function States({ row }: { row: WorktreeRow }): ReactElement {
  const { t } = useTranslation('code')
  return <span className="worktrees-panel-states">
    {row.missing ? <Badge intent="warning">{t('worktree.panel.missing')}</Badge> : null}
    {row.locked ? <Badge intent="warning">{t('worktree.panel.locked')}</Badge> : null}
    {row.merged.value
      ? <Badge intent="success">{row.merged.by === 'git' ? t('worktree.panel.mergedGit') : t('worktree.panel.merged')}</Badge>
      : row.prNumber !== null ? <Badge intent="info">{t('worktree.panel.openPr', { number: row.prNumber })}</Badge> : null}
    {row.changed > 0 ? <Badge intent="warning">{t('worktree.panel.changed', { count: row.changed })}</Badge> : null}
    {row.branchChanged ? <Badge>{t('worktree.panel.branchChanged')}</Badge> : null}
  </span>
}

function Row({ row, onRemove }: { row: WorktreeRow; onRemove: () => void }): ReactElement {
  const { t } = useTranslation('code')
  const reasonId = useId()
  const name = row.branch ?? t('worktree.detached')
  const reason = row.changed > 0 ? t('worktree.panel.dirtyReason') : row.locked ? t('worktree.panel.lockedReason') : null
  const conversation = row.conversation
    ? (row.conversation.gone ? t('worktree.panel.conversationGone', { title: row.conversation.title }) : row.conversation.title)
    : t('worktree.panel.noConversation')
  return <tr data-missing={row.missing ? 'true' : undefined}>
    <td>{conversation}</td>
    <td><code className="worktrees-panel-branch" title={row.path}>{name}</code></td>
    <td><States row={row} /></td>
    <td>{row.missing ? null : diskText(row.diskBytes)}</td>
    <td>{relativeAge(row.lastActivity)}</td>
    <td>
      <Button size="sm" variant="ghost" aria-label={t('worktree.removeLabel', { name })} aria-describedby={reason ? reasonId : undefined}
        disabled={reason !== null} onClick={onRemove}>{t('worktree.panel.remove')}</Button>
      {reason ? <span id={reasonId} className="worktrees-panel-reason">{reason}</span> : null}
    </td>
  </tr>
}

function RemoveDialog({ rootPath, row, onRemoved, onCancel }: { rootPath: string; row: WorktreeRow; onRemoved: () => void; onCancel: () => void }): ReactElement {
  const { t } = useTranslation('code')
  const [deleteBranch, setDeleteBranch] = useState(row.branch !== null && row.merged.value)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const unmerged = !row.merged.value

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    // An unmerged branch is deleted only when the person ticked the box after reading that its commits go with it.
    const input: RemoveInput = { rootPath, path: row.path, deleteBranch, ...(deleteBranch && unmerged ? { confirmUnmerged: true } : {}) }
    try {
      const result = await panelApi().remove(input)
      if (!result.ok) { setError(formatMainMessage(result.refusal as MainMessage)); return }
      const title = !deleteBranch ? t('worktree.panel.removedKept') : result.branchDeleted ? t('worktree.panel.removedDeleted') : t('worktree.panel.removedNotDeleted')
      toast({ intent: 'success', title })
      onRemoved()
    } catch (cause) {
      const message = messageFromError(cause)
      setError(message ? formatMainMessage(message) : humanizeError(cause))
    } finally {
      setBusy(false)
    }
  }

  return <ConfirmDialog danger busy={busy} error={error}
    title={t('worktree.panel.removeTitle', { path: row.path })}
    description={t('worktree.panel.removeBody')}
    confirmLabel={t('worktree.panel.remove')}
    onConfirm={() => void confirm()} onCancel={onCancel}>
    {row.branch ? <Checkbox label={t('worktree.panel.deleteBranch', { branch: row.branch })} checked={deleteBranch} disabled={busy}
      onChange={event => setDeleteBranch(event.currentTarget.checked)} /> : null}
    {deleteBranch && unmerged ? <Notice intent="warning">{t('worktree.panel.unmerged')}</Notice> : null}
  </ConfirmDialog>
}

/**
 * The Worktrees panel (1.5.0 A63, DESIGN U4.7): each worktree of the repository with its conversation, branch, merged
 * state, changed files, disk use and last activity, in main's order; and Remove, which main guards and may refuse (C3).
 */
export function WorktreesPanel({ rootPath }: { rootPath: string }): ReactElement {
  const { t } = useTranslation('code')
  const [rows, setRows] = useState<WorktreeRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [target, setTarget] = useState<WorktreeRow | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null)
    try {
      setRows(await panelApi().list({ rootPath }))
    } catch (error) {
      setLoadError(humanizeError(error))
    }
  }, [rootPath])

  useEffect(() => {
    let live = true
    panelApi().list({ rootPath }).then(
      found => { if (live) { setLoadError(null); setRows(found) } },
      error => { if (live) setLoadError(humanizeError(error)) }
    )
    return () => { live = false }
  }, [rootPath])

  return <div className="worktrees-panel" data-testid="worktrees-panel">
    {loadError ? <ErrorState compact title={t('worktree.panel.failed')} message={loadError} onRetry={() => void load()} />
      : rows === null ? <LoadingState label={t('worktree.panel.loading')} />
        : rows.length === 0 ? <EmptyState compact title={t('worktree.cleanup.none')} />
          : <div className="worktrees-panel-scroll" role="region" aria-label={t('worktree.panel.label')} tabIndex={0}>
            <table className="worktrees-panel-table">
              <thead><tr>
                <th scope="col">{t('worktree.panel.col.conversation')}</th>
                <th scope="col">{t('worktree.panel.col.branch')}</th>
                <th scope="col">{t('worktree.panel.col.state')}</th>
                <th scope="col">{t('worktree.panel.col.disk')}</th>
                <th scope="col">{t('worktree.panel.col.activity')}</th>
                <th scope="col">{t('worktree.panel.col.actions')}</th>
              </tr></thead>
              <tbody>{rows.map(row => <Row key={row.path} row={row} onRemove={() => setTarget(row)} />)}</tbody>
            </table>
          </div>}
    {target ? <RemoveDialog key={target.path} rootPath={rootPath} row={target}
      onCancel={() => setTarget(null)}
      onRemoved={() => { setTarget(null); void load() }} /> : null}
  </div>
}
