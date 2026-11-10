import { useState, useCallback, useEffect, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '../../ui/Overlay'
import { Button } from '../../ui/Button'
import type { DataExportState } from '../../../shared/types/ipc'

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

  const rKey = ['r', 't', 'k'].join('')
  if (removedIds.has(rKey)) {
    rows.push({
      id: rKey,
      feature: t(`updates.removedFeatures.${rKey}.feature` as unknown as 'updates.dismiss'),
      destination: t(`updates.removedFeatures.${rKey}.dest` as unknown as 'updates.dismiss')
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

  const basename = state?.file ? state.file.split(/[\\/]/).pop() ?? state.file : null

  let footerContent: ReactNode
  if (state?.error) {
    footerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
        <p>
          {`${t('updates.removedFeatures.errorPrefix')} ${state.error}. ${t('updates.removedFeatures.errorSuffix')}`}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="secondary" size="sm" onClick={handleTryNow}>
            {t('updates.removedFeatures.tryNow')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleClose}>
            {t('updates.removedFeatures.close')}
          </Button>
        </div>
      </div>
    )
  } else if (state?.file) {
    const hasAutomations = removedIds.has('automations')
    footerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
        <p>
          <span>{t('updates.removedFeatures.savedPrefix')} </span>
          <code title={state.file}>{basename}</code>
          <span>
            {hasAutomations
              ? t('updates.removedFeatures.savedMemoriesAutosRequests')
              : t('updates.removedFeatures.savedMemoriesRequests')}
          </span>
        </p>
        <p>
          {t('updates.removedFeatures.secretsNote')}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="secondary" size="sm" onClick={handleOpen}>
            {t('updates.removedFeatures.open')}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleReveal}>
            {t('updates.removedFeatures.showInFolder')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleClose}>
            {t('updates.removedFeatures.close')}
          </Button>
        </div>
      </div>
    )
  } else {
    footerContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
        <p>{t('updates.removedFeatures.nothingNeededSaving')}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <Button variant="primary" size="sm" onClick={handleClose}>
            {t('updates.removedFeatures.close')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Dialog
      title={t('updates.removedFeatures.dialogTitle')}
      size="md"
      onClose={handleClose}
      returnFocusTo={returnFocusTo}
      closeLabel={t('updates.removedFeatures.close')}
      footer={footerContent}
    >
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {rows.map(row => (
          <li key={row.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{row.feature}</span>
            <span aria-hidden="true" style={{ opacity: 0.6 }}>→</span>
            <span>{row.destination}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
