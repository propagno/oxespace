import { Plus } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppView } from '../../keyboard/keybindings'
import { Button } from '../../ui'
import { OxeLogo } from '../Brand/OxeLogo'

export interface NoWorkspaceStartProps {
  onNewWorkspace: () => void
  onSelectMode: (view: AppView) => void
  onAddProject: () => void
}

/**
 * OxeCode with no workspace yet: start one or go to another mode. The first run has one start, the FirstRun screen
 * (BRD-12, OXE-77), so this empty state never shows the first-run checklist as a second one.
 */
export function NoWorkspaceStart({ onNewWorkspace, onSelectMode }: NoWorkspaceStartProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="empty-state">
      <OxeLogo size={56} variant="hero" />
      <p>{t('app.start.prompt')}</p>
      <Button variant="primary" size="lg" icon={<Plus size={14} aria-hidden="true" />} onClick={onNewWorkspace}>{t('app.start.newWorkspace')}</Button>
      <div className="empty-state-alt" role="group" aria-label={t('app.start.otherWays')}>
        <span>{t('app.start.elsewhere')}</span>
        {(['thread', 'data'] as const).map(view => <Button key={view} variant="ghost" size="sm" onClick={() => onSelectMode(view)}>{t(`app.start.open.${view}`)}</Button>)}
      </div>
    </div>
  )
}
