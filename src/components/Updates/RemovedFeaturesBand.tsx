import { lazy, Suspense, useState, useEffect, useCallback, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Info, X } from 'lucide-react'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import styles from './RemovedFeaturesBand.module.css'
const WhatChangedDialog = lazy(() => import('./WhatChangedDialog').then(m => ({ default: m.WhatChangedDialog })))
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
        className={cx('removed-features-band', styles.band)}
      >
        {intent === 'warning'
          ? <AlertTriangle size={16} aria-hidden="true" className={styles.icon} />
          : <Info size={16} aria-hidden="true" className={styles.icon} />}
        <p className={styles.text}>
          {state.error
            ? t('updates.removedFeatures.warning')
            : t('updates.removedFeatures.info')}
        </p>
        <div className={styles.actions}>
          <Button variant="primary" size="sm" onClick={() => setShowDialog(true)}>
            {t('updates.removedFeatures.seeWhatChanged')}
          </Button>
          {state.error && (
            <Button variant="secondary" size="sm" onClick={handleTryNow} disabled={loading}>
              {t('updates.removedFeatures.tryNow')}
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          square
          className={styles.close}
          aria-label={t('updates.removedFeatures.dismiss')}
          title={t('updates.removedFeatures.dismiss')}
          onClick={handleDismiss}
          icon={<X size={14} aria-hidden="true" />}
        />
      </div>
      {showDialog && (
        <Suspense fallback={null}><WhatChangedDialog
          initialState={state}
          onClose={handleDialogClose}
          returnFocusTo={() => bandRef.current}
        /></Suspense>
      )}
    </>
  )
}
