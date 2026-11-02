import { useEffect, useState, type ReactElement } from 'react'
import type { PaneAgentState } from '../../../shared/types/agent-state'
import { Dialog } from '../../ui'
import { DetailList } from '../Navigation/DetailList'
import { formatDateTime } from '../../utils/formatTime'
import type { PaneDisplayState } from '../../utils/paneDisplay'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

/** What main returns from agentState.explain (agent-state.service.ts StateExplain), read defensively. */
interface StateExplain {
  state: PaneAgentState | null
  hook: { state: string; at: number } | null
  screen: { state: string; at: number; matchedRule: { id: string } | null; fallbackReason: string | null } | null
  pendingIdle: boolean
}

type Reading = { kind: 'reading' } | { kind: 'ready'; explain: StateExplain | null } | { kind: 'unavailable' } | { kind: 'failed' }

const lifecycleName = (state: string): string => tc(`paneMenu.explain.states.${state}`, { defaultValue: state })

/** Rows a person can read; the raw answer stays under "Technical details". Exported for the unit tests. */
export function explainRows(display: Pick<PaneDisplayState, 'statusLabel' | 'originLabel'>, explain: StateExplain | null): Array<{ label: string; detail: string }> {
  const rows = [
    { label: tc('paneMenu.explain.shown'), detail: display.statusLabel },
    { label: tc('paneMenu.explain.origin'), detail: display.originLabel ?? '—' }
  ]
  if (explain?.state) {
    rows.push({ label: tc('paneMenu.explain.lifecycle'), detail: lifecycleName(explain.state.state) })
    rows.push({ label: tc('paneMenu.explain.since'), detail: formatDateTime(explain.state.since) })
  }
  if (explain?.hook) rows.push({ label: tc('paneMenu.explain.hook'), detail: `${lifecycleName(explain.hook.state)} · ${formatDateTime(explain.hook.at)}` })
  // Rule ids and fallback codes are main's; they stay under "Technical details", the rows say them in words.
  if (explain?.screen?.matchedRule) rows.push({ label: tc('paneMenu.explain.screen'), detail: tc('paneMenu.explain.screenMatched', { state: lifecycleName(explain.screen.state) }) })
  else if (explain?.screen?.fallbackReason) rows.push({ label: tc('paneMenu.explain.fallback'), detail: tc(`paneMenu.explain.fallbacks.${explain.screen.fallbackReason}`, { defaultValue: tc('paneMenu.explain.fallbacks.other') }) })
  if (explain?.pendingIdle) rows.push({ label: tc('paneMenu.explain.pendingIdle'), detail: tc('paneMenu.explain.yes') })
  return rows
}

/** "Why this status?" from the pane's ⋯ menu: the status shown, where it comes from, and what main read (UX-07). */
export function StatusExplainDialog({ paneId, display, onClose }: { paneId: string; display: PaneDisplayState; onClose: () => void }): ReactElement {
  const [reading, setReading] = useState<Reading>({ kind: 'reading' })
  useEffect(() => {
    let active = true
    const explain = window.oxe?.agentState?.explain
    if (!explain) { setReading({ kind: 'unavailable' }); return }
    explain(paneId).then(value => { if (active) setReading({ kind: 'ready', explain: (value as StateExplain | null) ?? null }) }, () => { if (active) setReading({ kind: 'failed' }) })
    return () => { active = false }
  }, [paneId])
  const explain = reading.kind === 'ready' ? reading.explain : null
  const note = reading.kind === 'reading' ? tc('paneMenu.explain.reading')
    : reading.kind === 'unavailable' ? tc('paneMenu.explain.unavailable')
      : reading.kind === 'failed' ? tc('paneMenu.explain.failed')
        : !explain?.state ? tc('paneMenu.explain.none') : null
  return <Dialog className="desktop-details-dialog" title={tc('paneMenu.whyStatus')} description={tc('paneMenu.explain.description')} onClose={onClose} testId="status-explain-dialog">
    <DetailList rows={explainRows(display, explain)} />
    {note && <p className="terminal-session-identity-note" data-testid="status-explain-note">{note}</p>}
    {explain && <details className="terminal-technical-details"><summary>{tc('paneMenu.explain.technical')}</summary><pre className="status-explain-raw">{JSON.stringify(explain, null, 2)}</pre></details>}
  </Dialog>
}
