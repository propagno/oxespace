import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '../../store/ui.store'
import { Button } from '../../ui/Button'

export function NoEditorNote({ onClose }: { onClose?: () => void }): ReactElement {
  const { t } = useTranslation('code')
  const openSettings = (): void => {
    onClose?.()
    useUIStore.getState().openSettingsPage('general')
  }

  const message = t('editor.noExternalEditor', {
    defaultValue: 'No external editor found. Pick one in Settings › General › External editor, or install VS Code.'
  })
  const buttonLabel = t('editor.openExternalEditorSettings', {
    defaultValue: 'External editor'
  })

  return (
    <div className="editor-no-editor-note" role="note" style={{ padding: '8px 12px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span>{message}</span>
      <Button variant="secondary" size="sm" onClick={openSettings}>
        {buttonLabel}
      </Button>
    </div>
  )
}
