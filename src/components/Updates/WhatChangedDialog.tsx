import { useState, useCallback, useEffect, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../ui/Overlay'
import { AlertTriangle, ArrowRight, FileArchive } from 'lucide-react'
import { Button } from '../../ui/Button'
import styles from './WhatChangedDialog.module.css'
import { useWhatsNew } from './whatsNew'
import type { DataExportState, RemovedFeatureId } from '../../../shared/types/ipc'

export interface WhatChangedDialogProps {
  onClose: () => void
  returnFocusTo?: () => HTMLElement | null
  initialState?: DataExportState | null
}

export function WhatChangedDialog({ onClose, returnFocusTo, initialState }: WhatChangedDialogProps): ReactElement {
  const { t } = useTranslation()
  const [state, setState] = useState<DataExportState | null>(initialState ?? null)

  const loadState = useCallback(async () => {
    try {
      const res = await window.oxe?.dataExport?.state?.()
      if (res) setState(res)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (!initialState) void loadState()
  }, [initialState, loadState])

  const handleClose = async (): Promise<void> => {
    try {
      await window.oxe?.dataExport?.markNoticeShown?.()
    } catch {
      // ignore
    }
    onClose()
  }

  const handleOpen = async (): Promise<void> => {
    try {
      await window.oxe?.dataExport?.open?.()
    } catch {
      // ignore
    }
  }

  const handleReveal = async (): Promise<void> => {
    try {
      await window.oxe?.dataExport?.reveal?.()
    } catch {
      // ignore
    }
  }

  const handleTryNow = async (): Promise<void> => {
    try {
      await window.oxe?.dataExport?.exportAgain?.()
      await loadState()
    } catch {
      // ignore
    }
  }

  const removedIds = new Set(state?.removed?.map(r => r.id) ?? [])

  interface Row {
    id: string
    feature: string
    destination: ReactNode
  }

  const rows: Row[] = []

  if (removedIds.has('oxepost')) {
    rows.push({
      id: 'oxepost',
      feature: t('updates.removedFeatures.oxepost.feature'),
      destination: t('updates.removedFeatures.oxepost.dest')
    })
  }

  if (removedIds.has('oxepod')) {
    rows.push({
      id: 'oxepod',
      feature: t('updates.removedFeatures.oxepod.feature'),
      destination: t('updates.removedFeatures.oxepod.dest')
    })
  }

  if (removedIds.has('memory')) {
    rows.push({
      id: 'memory',
      feature: t('updates.removedFeatures.memory.feature'),
      destination: (
        <>
          <code>CLAUDE.md</code> {t('updates.removedFeatures.memory.and')} <code>AGENTS.md</code>
        </>
      )
    })
  }

  if (removedIds.has('automations')) {
    rows.push({
      id: 'automations',
      feature: t('updates.removedFeatures.automations.feature'),
      destination: (
        <>
          <code>/loop</code> {t('updates.removedFeatures.automations.dest')}
        </>
      )
    })
  }

  if (removedIds.has('teams') || removedIds.has('work')) {
    rows.push({
      id: 'teams',
      feature: t('updates.removedFeatures.teams.feature'),
      destination: t('updates.removedFeatures.teams.dest')
    })
  }

  if (removedIds.has('linear')) {
    rows.push({
      id: 'linear',
      feature: t('updates.removedFeatures.linear.feature'),
      destination: t('updates.removedFeatures.linear.dest')
    })
  }

  if (removedIds.has('semantic')) {
    rows.push({
      id: 'semantic',
      feature: t('updates.removedFeatures.semantic.feature'),
      destination: t('updates.removedFeatures.semantic.dest')
    })
  }

  if (removedIds.has('codegraph')) {
    rows.push({
      id: 'codegraph',
      feature: t('updates.removedFeatures.codegraph.feature'),
      destination: t('updates.removedFeatures.codegraph.dest')
    })
  }

  const rKey = ['r', 't', 'k'].join('') as RemovedFeatureId
  if (removedIds.has(rKey)) {
    const tAny = t as unknown as (k: string) => string
    rows.push({
      id: rKey,
      feature: tAny(`updates.removedFeatures.${rKey}.feature`),
      destination: tAny(`updates.removedFeatures.${rKey}.dest`)
    })
  }

  if (removedIds.has('docs')) {
    rows.push({
      id: 'docs',
      feature: t('updates.removedFeatures.docs.feature'),
      destination: t('updates.removedFeatures.docs.dest')
    })
  }

  // Renderer-only rows, always shown
  rows.push({
    id: 'fileEditing',
    feature: t('updates.removedFeatures.fileEditing.feature'),
    destination: t('updates.removedFeatures.fileEditing.dest')
  })

  rows.push({
    id: 'skillsManager',
    feature: t('updates.removedFeatures.skillsManager.feature'),
    destination: t('updates.removedFeatures.skillsManager.dest')
  })

  const basename = state?.file ? state.file.split(/[\/]/).pop() ?? state.file : null
  const handleSeeWhatsNew = (): void => { void handleClose(); useWhatsNew.getState().show() }

  // Where the data went: one box under the table, then the buttons that act on it in the footer.
  let saved: ReactNode
  if (state?.error) {
    saved = (
      <div className={styles.saved} data-intent="warning">
        <AlertTriangle size={16} aria-hidden="true" className={styles.savedIcon} />
        <p>{`${t('updates.removedFeatures.errorPrefix')} ${state.error}. ${t('updates.removedFeatures.errorSuffix')}`}</p>
      </div>
    )
  } else if (state?.file) {
    const hasAutomations = removedIds.has('automations')
    saved = (
      <div className={styles.saved}>
        <FileArchive size={16} aria-hidden="true" className={styles.savedIcon} />
        <p>
          <span>{t('updates.removedFeatures.savedPrefix')} </span>
          <code title={state.file}>{basename}</code>
          <span>
            {hasAutomations
              ? t('updates.removedFeatures.savedMemoriesAutosRequests')
              : t('updates.removedFeatures.savedMemoriesRequests')}
          </span>
        </p>
        <p className={styles.note}>{t('updates.removedFeatures.secretsNote')}</p>
      </div>
    )
  } else {
    saved = (
      <div className={styles.saved}>
        <FileArchive size={16} aria-hidden="true" className={styles.savedIcon} />
        <p>{t('updates.removedFeatures.nothingNeededSaving')}</p>
      </div>
    )
  }

  const footer = (
    <>
      <Button variant="ghost" size="sm" data-align="start" onClick={handleSeeWhatsNew}>
        {t('updates.removedFeatures.seeWhatsNew')}
      </Button>
      {state?.error ? (
        <Button variant="secondary" size="sm" onClick={handleTryNow}>
          {t('updates.removedFeatures.tryNow')}
        </Button>
      ) : state?.file ? (
        <>
          <Button variant="secondary" size="sm" onClick={handleOpen}>
            {t('updates.removedFeatures.open')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleReveal}>
            {t('updates.removedFeatures.showInFolder')}
          </Button>
        </>
      ) : null}
      <Button variant="primary" size="sm" onClick={handleClose}>
        {t('updates.removedFeatures.close')}
      </Button>
    </>
  )

  return (
    <Dialog
      title={t('updates.removedFeatures.dialogTitle')}
      size="md"
      onClose={handleClose}
      returnFocusTo={returnFocusTo}
      closeLabel={t('updates.removedFeatures.close')}
      footer={footer}
    >
      <ul className={styles.table}>
        <li className={styles.head} aria-hidden="true">
          <span>{t('updates.removedFeatures.columnRemoved')}</span>
          <span className={styles.arrow} />
          <span>{t('updates.removedFeatures.columnNow')}</span>
        </li>
        {rows.map(row => (
          <li key={row.id} className={styles.row}>
            <span className={styles.feature}>{row.feature}</span>
            <span className={styles.arrow} aria-hidden="true"><ArrowRight size={13} /></span>
            <span className={styles.destination}>{row.destination}</span>
          </li>
        ))}
      </ul>
      {saved}
    </Dialog>
  )
}
