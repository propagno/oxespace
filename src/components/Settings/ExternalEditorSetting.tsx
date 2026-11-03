import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { isOpenInPreference } from '../../../shared/types/open-in'
import { Select } from '../../ui'
import { useOpenInStore, useOpenInTargets } from '../../lib/openIn'

/**
 * F33 · Settings › General › "Editor externo": Automatic (the first detected: VS Code, Cursor, Zed) or one of the
 * detected editors. Main keeps the choice (B18); the path menu lists it first and Ctrl/Cmd+Shift+click opens it.
 */
export function ExternalEditorSetting(): ReactElement {
  const { t } = useTranslation('settings')
  const targets = useOpenInTargets()
  const editors = targets?.editors ?? []
  // A preferred editor that isn't installed any more reads as Automatic until it is back.
  const value = targets && editors.some(editor => editor.id === targets.preferred) ? targets.preferred : 'auto'
  return <div className="settings-general-card" data-testid="external-editor-setting"><div>
    <label htmlFor="external-editor">{t('general.externalEditor.label')}</label>
    <p>{editors.length ? t('general.externalEditor.hint') : t('general.externalEditor.none')}</p></div>
    <Select id="external-editor" value={value} disabled={!editors.length} onChange={event => {
      const next = event.target.value
      if (isOpenInPreference(next)) void useOpenInStore.getState().setPreference(next)
    }}>
      <option value="auto">{t('general.externalEditor.auto')}</option>
      {editors.map(editor => <option key={editor.id} value={editor.id}>{editor.name}</option>)}
    </Select>
  </div>
}
