import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'
import {
  CONVERSATION_MIN_WIDTH,
  REVIEW_DEFAULT_WIDTH,
  REVIEW_MIN_WIDTH,
  type ThreadPanel
} from '../../store/thread-workbench.store'
import { Splitter } from '../../ui/Splitter'

export type ThreadCompanionToolId = 'preview' | 'android' | 'files' | 'search'

type ToolPanelLabelKey =
  | 'thread:toolPanels.browser'
  | 'thread:toolPanels.android'
  | 'thread:toolPanels.files'
  | 'thread:toolPanels.search'

export interface ThreadToolPanelDef {
  readonly id: ThreadCompanionToolId
  readonly panel: ThreadPanel
  readonly label: string
}

function defineToolPanel(id: ThreadCompanionToolId, key: ToolPanelLabelKey): ThreadToolPanelDef {
  return {
    id,
    panel: id,
    get label(): string {
      return i18n.t(key)
    }
  }
}

export const THREAD_TOOL_PANELS: ReadonlyArray<ThreadToolPanelDef> = [
  defineToolPanel('preview', 'thread:toolPanels.browser'),
  defineToolPanel('android', 'thread:toolPanels.android'),
  defineToolPanel('files', 'thread:toolPanels.files'),
  defineToolPanel('search', 'thread:toolPanels.search')
]

export function clampToolPanelWidth(width: number, available: number): number {
  const max = Math.max(REVIEW_MIN_WIDTH, available - CONVERSATION_MIN_WIDTH)
  return Math.round(Math.min(Math.max(width, REVIEW_MIN_WIDTH), max))
}

export function ToolPanelSplitter(props: {
  width: number
  available: number
  onChange: (width: number) => void
}): ReactElement {
  const { width, available, onChange } = props
  const { t } = useTranslation('thread')
  const max = Math.max(REVIEW_MIN_WIDTH, available - CONVERSATION_MIN_WIDTH)
  const clamped = clampToolPanelWidth(width, available)

  return (
    <Splitter
      orientation="vertical"
      label={t('reviewHost.resize')}
      value={clamped}
      min={REVIEW_MIN_WIDTH}
      max={max}
      defaultValue={REVIEW_DEFAULT_WIDTH}
      after
      step={24}
      onChange={value => onChange(clampToolPanelWidth(value, available))}
    />
  )
}
