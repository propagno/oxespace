import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

export type ActivityLevel = 'thinking' | 'needs-decision' | 'awaiting' | 'idle' | 'error' | 'exited' | 'starting'

interface ActivityDotProps {
  level: ActivityLevel
  /**
   * Optional override for the aria-label. Defaults to a short label
   * derived from `level` (`activityDot.<level>` in the common catalog). Set this when the dot lives in a context where the
   * full sentence "Agent is X" doesn't make sense (e.g. an integration card
   * already labelled "agent: <role>").
   */
  ariaLabel?: string
  /** A status guessed from output timing: drawn weaker (dashed, dimmer) so it is not read as certain. */
  estimated?: boolean
  title?: string
}


/**
 * 6-tier activity indicator used wherever a "what state is this pane in"
 * dot needs to render — sidebar rows, pane headers, integration member
 * cards, workspace status summaries. CSS classes (`pane-activity-dot` +
 * `activity-<level>`) live in `styles/features/status.css` and define the visual
 * vocabulary: pulse for thinking/starting, solid brand for awaiting, flat
 * muted for idle/exited, red for error.
 *
 * Centralizing the JSX prevents three places (PaneSessionRow, PaneContainer,
 * IntegrationPanel) from drifting on the level → label mapping.
 */
export function ActivityDot({ level, ariaLabel, estimated, title }: ActivityDotProps): ReactElement {
  const { t } = useTranslation()
  const label = ariaLabel ?? t(`activityDot.${level}`)
  return <span className={`pane-activity-dot activity-${level}${estimated ? ' is-estimated' : ''}`} aria-label={label} title={title} />
}
