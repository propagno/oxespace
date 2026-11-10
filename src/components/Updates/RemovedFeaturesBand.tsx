import { useState, useEffect, useCallback, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { WhatChangedDialog } from './WhatChangedDialog'
import type { DataExportState } from '../../../shared/types/ipc'

export function RemovedFeaturesBand(): ReactElement | null {
  const { t } = useTranslation()
  const [state, setState] = useState<DataExportState | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [loading, setLoading] = useState(false)
  const bandRef = useRef<HTMLDivElement>(null)

  const loadState = useCallback(async () => {
    try {
      const res = await window.oxe?.dataExport?.state?.()
      if (res) setState(res)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    void loadState()
  }, [loadState])

  const handleDismiss = async (): Promise<void> => {
    try {
      await window.oxe?.dataExport?.markNoticeShown?.()
    } catch {
      // ignore
    }
    setDismissed(true)
  }

  const handleTryNow = async (): Promise<void> => {
    setLoading(true)
    try {
      await window.oxe?.dataExport?.exportAgain?.()
      await loadState()
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const handleDialogClose = (): void => {
    setShowDialog(false)
    setDismissed(true)
  }

  if (!state || !state.upgrade || state.shownNotice || dismissed) {
    return null
  }

  const intent = state.error ? 'warning' : 'info'

  return (
    <>
      <div
        ref={bandRef}
        role="status"
        aria-live="polite"
        data-intent={intent}
        className="removed-features-band"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 16px',
          gap: '12px',
          fontSize: '13px',
          background: intent === 'warning' ? 'var(--color-bg-warning, #fff3cd)' : 'var(--color-bg-info, #d1ecf1)',
          color: intent === 'warning' ? 'var(--color-text-warning, #856404)' : 'var(--color-text-info, #0c5460)',
          borderBottom: '1px solid var(--color-border-subtle, rgba(0,0,0,0.1))'
        }}
      >
        <span>
          {state.error
            ? t('updates.removedFeatures.warning')
            : t('updates.removedFeatures.info')}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {state.error && (
            <Button variant="secondary" size="sm" onClick={handleTryNow} disabled={loading}>
              {t('updates.removedFeatures.tryNow')}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setShowDialog(true)}>
            {t('updates.removedFeatures.seeWhatChanged')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('updates.removedFeatures.dismiss')}
            onClick={handleDismiss}
          >
            <X size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {showDialog && (
        <WhatChangedDialog
          initialState={state}
          onClose={handleDialogClose}
          returnFocusTo={() => bandRef.current}
        />
      )}
    </>
  )
}
