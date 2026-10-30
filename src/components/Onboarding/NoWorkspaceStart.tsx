import { Plus } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppView } from '../../keyboard/keybindings'
import { Button } from '../../ui'
import { OxeLogo } from '../Brand/OxeLogo'
import { FirstRunChecklist } from './FirstRunChecklist'

/** OxeCode with no workspace yet: start one, go to another mode, or follow the first-run guide. */
export function NoWorkspaceStart({ onNewWorkspace, onSelectMode, onAddProject }: { onNewWorkspace: () => void; onSelectMode: (view: AppView) => void; onAddProject: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="empty-state">
      <OxeLogo size={72} variant="hero" />
      <p>{t('app.start.prompt')}</p>
      <Button variant="primary" size="lg" icon={<Plus size={14} aria-hidden="true" />} onClick={onNewWorkspace}>{t('app.start.newWorkspace')}</Button>
      <div className="empty-state-alt" role="group" aria-label={t('app.start.otherWays')}>
        <span>{t('app.start.elsewhere')}</span>
        {(['thread', 'data', 'pods', 'post'] as const).map(view => <Button key={view} variant="ghost" size="sm" onClick={() => onSelectMode(view)}>{t(`app.start.open.${view}`)}</Button>)}
      </div>
      <FirstRunChecklist onNewWorkspace={onNewWorkspace} onAddProject={onAddProject} />
    </div>
  )
}
