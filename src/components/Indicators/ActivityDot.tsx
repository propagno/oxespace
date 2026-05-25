import type { ReactElement } from 'react'

export type ActivityLevel = 'thinking' | 'awaiting' | 'idle' | 'error' | 'exited' | 'starting'

interface ActivityDotProps {
  level: ActivityLevel
  /**
   * Optional override for the aria-label. Defaults to a short English label
   * derived from `level`. Set this when the dot lives in a context where the
   * full sentence "Agent is X" doesn't make sense (e.g. an integration card
   * already labelled "agent: <role>").
   */
  ariaLabel?: string
}

const DEFAULT_LABELS: Record<ActivityLevel, string> = {
  thinking: 'Agent is thinking',
  awaiting: 'Awaiting your input',
  idle: 'Idle',
  error: 'Needs attention',
  starting: 'Starting',
  exited: 'Exited'
}

/**
 * 6-tier activity indicator used wherever a "what state is this pane in"
 * dot needs to render — sidebar rows, pane headers, integration member
 * cards, workspace status summaries. CSS classes (`pane-activity-dot` +
 * `activity-<level>`) live in `features.css` and define the visual
 * vocabulary: pulse for thinking/starting, solid brand for awaiting, flat
 * muted for idle/exited, red for error.
 *
 * Centralizing the JSX prevents three places (PaneSessionRow, PaneContainer,
 * IntegrationPanel) from drifting on the level → label mapping.
 */
export function ActivityDot({ level, ariaLabel }: ActivityDotProps): ReactElement {
  const label = ariaLabel ?? DEFAULT_LABELS[level]
  return <span className={`pane-activity-dot activity-${level}`} aria-label={label} />
}
