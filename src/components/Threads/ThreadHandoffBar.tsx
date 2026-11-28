import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CustomAgentHandoff } from '../../../shared/types/custom-agents'
import { Button } from '../../ui'
import styles from './ThreadHandoffBar.module.css'

export interface ThreadHandoffBarProps {
  sourceLabel: string
  handoffs: readonly CustomAgentHandoff[]
  disabled?: boolean
  onSelect: (handoff: CustomAgentHandoff) => void
}

/** Calm Obsidian Minimal hairline strip rendered after a completed turn when handoffs apply (OXE-481). */
export function ThreadHandoffBar({ sourceLabel, handoffs, disabled = false, onSelect }: ThreadHandoffBarProps) {
  const { t } = useTranslation('thread')
  if (!handoffs.length) return null
  return (
    <div className={styles.strip} data-ui="handoff-bar" role="region" aria-label={t('handoffs.region')}>
      <span className={styles.label}>{t('handoffs.proceedFrom', { name: sourceLabel })}</span>
      <div className={styles.actions}>
        {handoffs.map((handoff, index) => (
          <Button
            key={`${handoff.label}:${handoff.agent ?? handoff.mode ?? index}`}
            variant="ghost"
            size="sm"
            className={styles.action}
            disabled={disabled}
            icon={<ArrowRight size={12} aria-hidden="true" />}
            onClick={() => onSelect(handoff)}
          >
            {handoff.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
