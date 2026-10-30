import { useState, type ReactElement } from 'react'
import { ClipboardCopy, MessageSquarePlus, PackageOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DIAGNOSTICS_LIMITS } from '../../../shared/types/diagnostics'
import { useThreadStore } from '../../store/thread.store'
import { Button, Panel, Toolbar, copyText, toast } from '../../ui'
import { runCommand } from '../../utils/commandRegistry'
import { humanizeError } from '../../utils/humanizeError'
import { BundleExportDialog } from './BundleExportDialog'
import { healthCards } from './diagnosticsHealth'
import { HealthCards } from './HealthCards'
import { IncidentJournal } from './IncidentJournal'
import { useDiagnosticsMetrics, useIncidents } from './useDiagnostics'
import styles from './Diagnostics.module.css'

async function analysisSummary(): Promise<string> {
  const api = window.oxe?.diagnostics
  if (!api?.analysisSummary) throw new Error('The diagnostics summary is not available in this version.')
  return (await api.analysisSummary()).slice(0, DIAGNOSTICS_LIMITS.maxSummaryChars)
}

/**
 * Help › Diagnostics (Settings › Diagnostics): live health cards, the problem journal, and the three ways to hand a
 * problem over: copy the summary, export the redacted bundle after a preview, or ask for an analysis in a new
 * conversation with the summary in its draft. It measures only while mounted.
 *
 * `onLeave` closes the place the panel lives in, so the new conversation is in front.
 */
export function DiagnosticsPanel({ onLeave }: { onLeave: () => void }): ReactElement {
  const { t } = useTranslation('settings')
  const { metrics, cpuSamples, status } = useDiagnosticsMetrics()
  const journal = useIncidents()
  const [exporting, setExporting] = useState(false)
  const [busy, setBusy] = useState<'copy' | 'ask' | null>(null)
  const cards = metrics ? healthCards(metrics, cpuSamples, journal.incidents) : null
  const api = window.oxe?.diagnostics

  const copy = async (): Promise<void> => {
    setBusy('copy')
    try { await copyText(await analysisSummary(), t('diagnostics.actions.copyWhat')) }
    catch (cause) { toast({ title: t('diagnostics.actions.summaryFailed'), description: humanizeError(cause), intent: 'danger' }) }
    finally { setBusy(null) }
  }

  // The summary, never the bundle, goes to the new conversation's draft; the person reviews and sends it.
  const ask = async (): Promise<void> => {
    setBusy('ask')
    let text: string
    try { text = await analysisSummary() }
    catch (cause) { toast({ title: t('diagnostics.actions.summaryFailed'), description: humanizeError(cause), intent: 'danger' }); setBusy(null); return }
    const store = useThreadStore.getState()
    store.setPendingDraft({ text, source: 'diagnostics' })
    setBusy(null)
    onLeave()
    // After Settings closes, so the new conversation dialog takes focus.
    requestAnimationFrame(() => {
      if (runCommand('thread.new')) return
      useThreadStore.getState().setPendingDraft(null)
      toast({ title: t('diagnostics.actions.askFailed'), intent: 'danger' })
    })
  }

  return <div className={styles.panel} data-testid="diagnostics-panel">
    <Toolbar label={t('diagnostics.actions.label')} className={styles.toolbar}>
      <Button icon={<ClipboardCopy size={14} aria-hidden="true" />} loading={busy === 'copy'} disabled={!api?.analysisSummary || busy !== null} onClick={() => { void copy() }}>
        {t('diagnostics.actions.copy')}
      </Button>
      <Button icon={<PackageOpen size={14} aria-hidden="true" />} disabled={!api?.previewBundle} onClick={() => setExporting(true)}>
        {t('diagnostics.actions.export')}
      </Button>
      <Button variant="primary" icon={<MessageSquarePlus size={14} aria-hidden="true" />} loading={busy === 'ask'} disabled={!api?.analysisSummary || busy !== null}
        aria-describedby="diagnostics-ask-hint" onClick={() => { void ask() }}>
        {t('diagnostics.actions.ask')}
      </Button>
      <span id="diagnostics-ask-hint" className={styles.hint}>{t('diagnostics.actions.askHint')}</span>
    </Toolbar>
    <Panel title={t('diagnostics.health.title')} className={styles.section} label={t('diagnostics.health.title')}>
      <p className={styles.note}>{t('diagnostics.health.measuring')}</p>
      <HealthCards cards={cards} status={status} />
    </Panel>
    <IncidentJournal incidents={journal.incidents} status={journal.status} reload={journal.reload} />
    {exporting && <BundleExportDialog onClose={() => setExporting(false)} />}
  </div>
}
