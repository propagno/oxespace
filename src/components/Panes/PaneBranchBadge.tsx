import { GitBranch } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

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
export function PaneBranchBadge(props: { paneId: string }): ReactElement | null {
  const { paneId } = props
  const { t } = useTranslation('thread')
  const [state, setState] = useState<PaneBranchState | null>(null)

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

  if (!state?.branch) return null
  const label = state.switched
    ? t('paneBranch.switched', { branch: state.branch, from: state.startedOn })
    : t('paneBranch.on', { branch: state.branch })
  return (
    <span className="pane-branch-badge" data-tone={state.switched ? 'warning' : 'neutral'} role="img" aria-label={label} title={label}>
      <GitBranch size={12} aria-hidden="true" />
      <span>{state.branch}</span>
    </span>
  )
}
