import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sun } from 'lucide-react'
import { useOxeQueryStore } from './oxequery.store'
import { useAgentActivityFilter } from '../../store/agent-activity-filter.store'

interface BadgeState {
  today: number
  waiting: boolean
}

/** Agent activity of a connection today; amber (--attn) while an agent waits. Live: main pushes agentActivity:changed. */
export function AgentActivityBadge({ connectionId }: { connectionId: string }) {
  const { t } = useTranslation('oxequery')
  const [data, setData] = useState<BadgeState | null>(null)

  useEffect(() => {
    const api = window.oxe?.agentActivity
    const badge = api?.badge
    if (!badge) return
    let active = true
    const load = (): void => {
      badge({ connectionId })
        .then(res => {
          if (active && res) setData({ today: res.today, waiting: res.waiting })
        })
        .catch(() => {
          if (active) setData(null)
        })
    }
    load()
    const unsubscribe = api?.onChanged?.(change => {
      if (!active) return
      if (change?.connectionId && change.connectionId !== connectionId) return
      load()
    })
    return () => {
      active = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [connectionId])

  if (!data || data.today <= 0) return null

  const label = t('agentActivity.badge', { count: data.today })

  const handleClick = () => {
    useAgentActivityFilter.getState().open({ sources: ['databases'], connection: connectionId })
    useOxeQueryStore.getState().openActivity()
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
