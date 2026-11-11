import { FolderGit2, GitBranch } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { useGitBranch } from '../../hooks/useGitBranch'
import { i18n } from '../../i18n'
import { useTerminalStore } from '../../store/terminal.store'
import { gitBranchLabel, paneGitContext } from '../../utils/paneGitContext'

const tc = i18n.getFixedT(null, 'code')

/** What main reports for a pane's branch (BACKEND #704 §A18). */
export interface PaneBranchState {
  branch: string
  startedOn: string
  switched: boolean
}

interface PaneBranchEvent extends PaneBranchState {
  paneId: string
}

interface PaneBranchBridge {
  branch?: (paneId: string) => Promise<PaneBranchState | null | undefined>
  // The preload takes (paneId, listener) (shared/types/ipc.ts TerminalApi); BACKEND #704's contract named (listener).
  onBranchChanged?: ((paneId: string, listener: (event: PaneBranchEvent) => void) => () => void)
    | ((listener: (event: PaneBranchEvent) => void) => () => void)
}

function subscribe(api: PaneBranchBridge | undefined, paneId: string, listener: (event: PaneBranchEvent) => void): (() => void) | undefined {
  const on = api?.onBranchChanged
  if (!on) return undefined
  if (on.length >= 2) return (on as (id: string, fn: (event: PaneBranchEvent) => void) => () => void)(paneId, listener)
  return (on as (fn: (event: PaneBranchEvent) => void) => () => void)(listener)
}

function bridge(): PaneBranchBridge | undefined {
  return (window as unknown as { oxe?: { terminal?: PaneBranchBridge } }).oxe?.terminal
}

/** The pane's branch (DESIGN U4.4); a warning tone with "switched from X" once the pane left the branch it started on. */
export function PaneBranchBadge(props: { paneId: string; workspace?: Workspace; pane?: WorkspacePane }): ReactElement | null {
  const { paneId, workspace, pane } = props
  const { t } = useTranslation('thread')
  const [state, setState] = useState<PaneBranchState | null>(null)
  const location = useTerminalStore(s => (pane ? s.panes[pane.id]?.location ?? null : null))
  const context = workspace && pane ? paneGitContext(workspace, pane, location) : null
  const gitStatus = useGitBranch(workspace?.id ?? '', context?.rootPath ?? null, Boolean(context))

  useEffect(() => {
    const api = bridge()
    let alive = true
    setState(null)
    void api?.branch?.(paneId).then(value => { if (alive && value) setState(value) }, () => undefined)
    const off = subscribe(api, paneId, event => {
      if (!alive || !event || event.paneId !== paneId) return
      setState({ branch: event.branch, startedOn: event.startedOn, switched: event.switched })
    })
    return () => { alive = false; off?.() }
  }, [paneId])

  const moved = Boolean(context?.moved)
  if (state?.branch && !moved) {
    const label = state.switched
      ? t('paneBranch.switched', { branch: state.branch, from: state.startedOn })
      : t('paneBranch.on', { branch: state.branch })
    return (
      <span className="pane-branch-badge" data-testid="pane-branch-badge" data-tone={state.switched ? 'warning' : 'neutral'}
        data-moved={state.switched ? 'true' : undefined} role="img" aria-label={label} title={label}>
        <GitBranch size={12} aria-hidden="true" />
        <span>{state.branch}</span>
      </span>
    )
  }

  if (!context) return null
  // A folder that is simply not a git repository has no branch to report; saying so on every pane is noise.
  if (gitStatus && !gitStatus.branch && !gitStatus.detached && !gitStatus.error) return null
  const label = gitBranchLabel(gitStatus)
  const warning = !moved && context.sharedCount > 1 ? `\n${tc('workspace.branch.shared', { count: context.sharedCount })}` : ''
  const where = moved
    ? `\n${tc('workspace.branch.movedTo', { path: context.rootPath })}\n${tc('workspace.branch.openedIn', { path: context.launchRoot })}`
    : `\n${tc('workspace.branch.directory', { path: context.rootPath })}${context.outside ? `\n${tc('workspace.branch.outside', { path: context.outside })}` : ''}`
  return (
    <span className={`pane-branch-badge${moved ? ' is-moved' : ''}`} data-testid="pane-branch-badge"
      data-tone={moved ? 'warning' : 'neutral'} data-moved={moved ? 'true' : undefined}
      title={`${label}${where}${warning}${gitStatus?.error ? `\n${gitStatus.error}` : ''}`}>
      {moved ? <FolderGit2 size={12} aria-hidden="true" /> : <GitBranch size={12} aria-hidden="true" />}
      <span>{label}</span>
      {moved && <span>· {tc('changes.ref.worktree')}</span>}
      {!moved && context.sharedCount > 1 && <span aria-label={tc('workspace.branch.shared', { count: context.sharedCount })}>· {context.sharedCount}</span>}
    </span>
  )
}
