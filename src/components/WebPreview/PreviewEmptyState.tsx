import { MonitorPlay } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, EmptyState } from '../../ui'

export interface PreviewEmptyStateProps {
  kind: 'down' | 'none'
  url?: string
  devScript?: string
  onRunDev?: () => void
}

export function PreviewEmptyState({ kind, url, devScript, onRunDev }: PreviewEmptyStateProps): ReactElement {
  const { t } = useTranslation('code')
  if (kind === 'down') {
    return (
      <EmptyState
        icon={<MonitorPlay size={20} />}
        title={t('agentBrowser.downTitle', { url: url ?? 'localhost' })}
        actions={
          devScript && onRunDev ? (
            <Button variant="primary" size="sm" onClick={onRunDev}>
              {t('agentBrowser.runDev', { script: devScript })}
            </Button>
          ) : undefined
        }
      >
        {t('agentBrowser.downHint')}
      </EmptyState>
    )
  }
  return (
    <EmptyState
      icon={<MonitorPlay size={20} />}
      title={t('agentBrowser.noneTitle')}
      actions={
        devScript && onRunDev ? (
          <Button variant="primary" size="sm" onClick={onRunDev}>
            {t('agentBrowser.runDev', { script: devScript })}
          </Button>
        ) : undefined
      }
    >
      {t('agentBrowser.noneHint')}
    </EmptyState>
  )
}
