import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { isOpenInPreference } from '../../../shared/types/open-in'
import { Select, SettingRow } from '../../ui'
import { useOpenInStore, useOpenInTargets } from '../../lib/openIn'

/**
 * F33 · Settings › General › "Editor externo": Automatic (the first detected: VS Code, Cursor, Zed) or one of the
 * detected editors. Main keeps the choice (B18); the path menu lists it first and Ctrl/Cmd+Shift+click opens it.
 * A SettingRow (BRD-06): it sits in the section General gives it.
 */
export function ExternalEditorSetting(): ReactElement {
  const { t } = useTranslation('settings')
  const targets = useOpenInTargets()
  const editors = targets?.editors ?? []
  // A preferred editor that isn't installed any more reads as Automatic until it is back.
  const value = targets && editors.some(editor => editor.id === targets.preferred) ? targets.preferred : 'auto'
  return <SettingRow testId="external-editor-setting" htmlFor="external-editor" label={t('general.externalEditor.label')}
    description={editors.length ? t('general.externalEditor.hint') : t('general.externalEditor.none')}
    control={<Select id="external-editor" value={value} disabled={!editors.length} onChange={event => {
      const next = event.target.value
      if (isOpenInPreference(next)) void useOpenInStore.getState().setPreference(next)
    }}>
      <option value="auto">{t('general.externalEditor.auto')}</option>
      {editors.map(editor => <option key={editor.id} value={editor.id}>{editor.name}</option>)}
    </Select>} />
}
