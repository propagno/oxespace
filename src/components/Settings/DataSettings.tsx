import { useState, useCallback, useEffect, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui/Button'
import { SettingRow, SettingsSection } from '../../ui/Settings'
import { UsageSettings } from './UsageSettings'
import type { DataExportState } from '../../../shared/types/ipc'

export function DataSettings(): ReactElement {
  const { t } = useTranslation('settings')
  const [state, setState] = useState<DataExportState | null>(null)
  const [loading, setLoading] = useState(false)

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

  const handleExportAgain = async (): Promise<void> => {
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

  const handleReveal = async (): Promise<void> => {
    try {
      await window.oxe?.dataExport?.reveal?.()
    } catch {
      // ignore
    }
  }

  const basename = state?.file ? state.file.split(/[\\/]/).pop() ?? state.file : null

  let descText: ReactNode
  if (state?.error) {
    descText = t('data.errorDesc', { error: state.error })
  } else if (state?.file) {
    const dateStr = state.exportedAt ? new Date(state.exportedAt).toLocaleDateString() : ''
    descText = t('data.savedDesc', { date: dateStr, file: basename })
  } else {
    descText = t('data.exportDesc')
  }

  return (
    <section className="settings-general" data-testid="data-settings">
      <h2>{t('center.pages.privacy.label')}</h2>
      <p>{t('data.description')}</p>
      <UsageSettings />
      <SettingsSection title={t('data.removedSection')}>
        <SettingRow
          label={t('data.exportLabel')}
          description={descText}
          control={
            <div style={{ display: 'flex', gap: '8px' }}>
              {state?.file && (
                <Button variant="secondary" size="sm" onClick={handleReveal}>
                  {t('data.showInFolder')}
                </Button>
              )}
              {state?.error && (
                <Button variant="secondary" size="sm" onClick={handleExportAgain} disabled={loading}>
                  {t('data.tryNow')}
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={handleExportAgain} disabled={loading}>
                {t('data.exportAction')}
              </Button>
            </div>
          }
        />
      </SettingsSection>
    </section>
  )
}
