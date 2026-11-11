import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sun } from 'lucide-react'
import { useUIStore } from '../../store/ui.store'
import { useAgentActivityFilter } from '../../store/agent-activity-filter.store'

interface BadgeState {
  today: number
  waiting: boolean
}

export function AgentActivityBadge({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation('oxequery')
  const [data, setData] = useState<BadgeState | null>(null)

  useEffect(() => {
    const badge = window.oxe?.agentActivity?.badge
    if (!badge) return
    let active = true
    badge({ connectionId })
      .then(res => {
        if (active && res) {
          setData(res)
        }
      })
      .catch(() => {
        if (active) setData(null)
      })
    return () => { active = false }
  }, [connectionId])

  if (!data || data.today <= 0) return null

  const label = t('agentActivity.badge', { count: data.today })

  const handleClick = () => {
    useAgentActivityFilter.getState().open({ sources: ['databases'], connection: connectionId })
    useUIStore.getState().openSettingsPage('activity')
  }

  return (
    <button
      type="button"
      className="oq-badge oq-agent-activity-badge"
      aria-label={label}
      data-tone={data.waiting ? 'attn' : undefined}
      onClick={handleClick}
    >
      {data.waiting && <Sun size={12} data-icon="sun" aria-hidden="true" />}
      <span>{label}</span>
    </button>
  )
}
