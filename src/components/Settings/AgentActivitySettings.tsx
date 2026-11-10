import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui'
import { formatClock, formatDate } from '../../utils/formatTime'
import { resultChip } from './agentActivityModel'
import { AgentActivityDetail } from './AgentActivityDetail'
import { useAgentActivityFilter } from '../../store/agent-activity-filter.store'

type ActivityRow = Record<string, unknown>

interface AgentActivityListResult {
  rows: ActivityRow[]
  cursor: string | null
  failedSources: string[]
}

const SOURCES = [
  { key: 'all', labelKey: 'activity.sources.all', defaultLabel: 'All' },
  { key: 'changes', labelKey: 'activity.sources.changes', defaultLabel: 'Changes' },
  { key: 'databases', labelKey: 'activity.sources.databases', defaultLabel: 'Databases' },
  { key: 'http', labelKey: 'activity.sources.http', defaultLabel: 'HTTP' },
  { key: 'containers', labelKey: 'activity.sources.containers', defaultLabel: 'Containers' }
] as const

export function AgentActivitySettings(): ReactElement {
  const { t } = useTranslation('settings')
  const initialFilter = useAgentActivityFilter.getState().filter

  const initialSource = Array.isArray(initialFilter?.sources) && initialFilter.sources[0]
    ? String(initialFilter.sources[0])
    : null

  const selectedSourceRef = useRef<string | null>(initialSource)
  const cursorRef = useRef<string | null>(null)
  const lastFocusedRowRef = useRef<HTMLElement | null>(null)
  const tbodyRef = useRef<HTMLTableSectionElement>(null)

  const [selectedSource, setSelectedSource] = useState<string | null>(initialSource)
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [failedSources, setFailedSources] = useState<string[]>([])
  const [activeModalRow, setActiveModalRow] = useState<ActivityRow | null>(null)
  const [isFiltered, setIsFiltered] = useState<boolean>(Boolean(initialSource || (initialFilter && Object.keys(initialFilter).length > 0)))

  const executeFetch = async (opts: { append?: boolean; source?: string | null; resetFilters?: boolean } = {}): Promise<void> => {
    const api = window.oxe?.agentActivity
    if (!api?.list) return

    const activeSource = opts.source !== undefined ? opts.source : selectedSourceRef.current
    const query: Record<string, unknown> = {}

    if (activeSource) {
      query.sources = [activeSource]
    }

    if (!opts.resetFilters) {
      const storeFilter = useAgentActivityFilter.getState().filter
      if (storeFilter) {
        for (const [k, v] of Object.entries(storeFilter)) {
          if (k !== 'sources') query[k] = v
        }
      }
    }

    if (opts.append && cursorRef.current) {
      query.cursor = cursorRef.current
    }

    try {
      const res = (await api.list(query)) as unknown as AgentActivityListResult
      const nextCursor = res.cursor ?? null
      cursorRef.current = nextCursor
      setCursor(nextCursor)
      setFailedSources(res.failedSources ?? [])
      if (opts.append) {
        setRows((prev) => [...prev, ...(res.rows ?? [])])
      } else {
        setRows(res.rows ?? [])
      }
    } catch {
      if (!opts.append) {
        setRows([])
      }
    }
  }

  useEffect(() => {
    void executeFetch({ source: selectedSourceRef.current })
  }, [])

  const handleSourceClick = (key: string): void => {
    const next = key === 'all' ? null : key
    selectedSourceRef.current = next
    setSelectedSource(next)
    setIsFiltered(Boolean(next))
    cursorRef.current = null
    setCursor(null)
    void executeFetch({ source: next })
  }

  const handleClearFilters = (): void => {
    useAgentActivityFilter.getState().clear()
    selectedSourceRef.current = null
    setSelectedSource(null)
    setIsFiltered(false)
    cursorRef.current = null
    setCursor(null)
    void executeFetch({ source: null, resetFilters: true })
  }

  const handleLoadMore = (): void => {
    void executeFetch({ append: true })
  }

  const handleTryAgain = (): void => {
    void executeFetch({ source: selectedSourceRef.current })
  }

  const handleRowKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, index: number, row: ActivityRow): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const trs = tbodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[role="row"]')
      if (trs && index + 1 < trs.length) {
        trs[index + 1].focus()
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const trs = tbodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[role="row"]')
      if (trs && index - 1 >= 0) {
        trs[index - 1].focus()
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      lastFocusedRowRef.current = e.currentTarget
      setActiveModalRow(row)
    }
  }

  const handleRowClick = (e: React.MouseEvent<HTMLTableRowElement>, row: ActivityRow): void => {
    lastFocusedRowRef.current = e.currentTarget
    setActiveModalRow(row)
  }

  const formatWhen = (timestamp: unknown): string => {
    if (typeof timestamp !== 'number' && typeof timestamp !== 'string') return ''
    const ts = Number(timestamp)
    if (isNaN(ts)) return ''
    const today = new Date()
    const date = new Date(ts)
    if (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    ) {
      return formatClock(date)
    }
    return formatDate(date)
  }

  const renderConversation = (actorRaw: unknown): ReactElement => {
    if (actorRaw && typeof actorRaw === 'object') {
      const actor = actorRaw as Record<string, unknown>
      const name = String(actor.name || actor.id || '')
      if (actor.gone === true) {
        return (
          <span>
            {name} <span className="text-muted">{t('activity.actorRemoved', { defaultValue: '(removed)' })}</span>
          </span>
        )
      }
      return <span>{name}</span>
    }
    return <span>{String(actorRaw ?? '')}</span>
  }

  return (
    <div className="settings-form-group agent-activity-settings" data-testid="agent-activity">
      <h3 className="settings-form-group-title">{t('activity.title')}</h3>
      <p className="settings-field-hint">{t('activity.hint')}</p>

      <div className="agent-activity-sources" role="toolbar" aria-label={t('activity.sources.all')}>
        {SOURCES.map(({ key, labelKey, defaultLabel }) => {
          const isSelected = key === 'all' ? selectedSource === null : selectedSource === key
          const isFailed = key !== 'all' && failedSources.includes(key)
          const baseLabel = t(labelKey, { defaultValue: defaultLabel })
          const label = isFailed ? `${baseLabel} —` : baseLabel

          return (
            <Button
              key={key}
              variant={isSelected ? 'primary' : 'ghost'}
              size="sm"
              aria-pressed={isSelected}
              onClick={() => handleSourceClick(key)}
            >
              {label}
            </Button>
          )
        })}
      </div>

      {failedSources.length > 0 && (
        <div className="settings-notice" role="status">
          <span>{t('activity.sourcesFailed')}</span>
          <Button variant="ghost" size="sm" onClick={handleTryAgain}>
            {t('activity.tryAgain')}
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="agent-activity-empty">
          {isFiltered ? (
            <>
              <p>{t('activity.emptyFiltered')}</p>
              <Button variant="secondary" onClick={handleClearFilters}>
                {t('activity.clearFilters')}
              </Button>
            </>
          ) : (
            <p>{t('activity.empty')}</p>
          )}
        </div>
      ) : (
        <>
          <table className="agent-activity-table">
            <thead>
              <tr>
                <th scope="col">{t('activity.columns.when')}</th>
                <th scope="col">{t('activity.columns.conversation')}</th>
                <th scope="col">{t('activity.columns.what')}</th>
                <th scope="col">{t('activity.columns.result')}</th>
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {rows.map((row, index) => {
                const chip = resultChip(row)
                return (
                  <tr
                    key={String(row.id ?? index)}
                    role="row"
                    tabIndex={0}
                    onKeyDown={(e) => handleRowKeyDown(e, index, row)}
                    onClick={(e) => handleRowClick(e, row)}
                  >
                    <td>{formatWhen(row.at)}</td>
                    <td>{renderConversation(row.actor)}</td>
                    <td>
                      <code>{String(row.summary ?? '')}</code>
                    </td>
                    <td>
                      <span className={`chip tone-${chip.tone}`}>{chip.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {cursor !== null && (
            <div className="agent-activity-load-more">
              <Button onClick={handleLoadMore}>{t('activity.loadMore')}</Button>
            </div>
          )}
        </>
      )}

      {activeModalRow && (
        <AgentActivityDetail
          row={activeModalRow}
          onClose={() => {
            setActiveModalRow(null)
            lastFocusedRowRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}
