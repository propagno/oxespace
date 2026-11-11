import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

export interface ContainerOption {
  id: string
  name: string
  engine: 'postgres' | 'mongodb'
  engineLabel: string
  port: number
  suggestion: Record<string, unknown>
}

interface ContainerPickerProps {
  source: 'details' | 'container'
  onSourceChange(source: 'details' | 'container'): void
  selectedId: string
  onSelect(container: ContainerOption): void
}

export function ContainerPicker({ source, onSourceChange, selectedId, onSelect }: ContainerPickerProps): ReactElement {
  const { t } = useTranslation('oxequery')
  const [loading, setLoading] = useState(true)
  const [containers, setContainers] = useState<ContainerOption[]>([])
  const [disabledReason, setDisabledReason] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    async function loadContainers(): Promise<void> {
      setLoading(true)
      const api = (window as unknown as { oxe?: { oxePod?: { call(op: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: { code?: string; message?: string } }> } } }).oxe?.oxePod
      if (!api) {
        if (active) {
          setDisabledReason(t('form.dockerNotRunning'))
          setLoading(false)
        }
        return
      }

      try {
        const response = await api.call('containers.list', {})
        if (!active) return
        if (!response.ok) {
          setDisabledReason(t('form.dockerNotRunning'))
          setLoading(false)
          return
        }

        const data = response.value as { containers?: Array<{ id: string; name: string; state?: string; status?: string }> } | undefined
        const all = data?.containers ?? []
        const running = all.filter(c => c.state === 'running' || c.status === 'running')
        const found: ContainerOption[] = []

        for (const c of running) {
          try {
            const sugRes = await api.call('containers.suggestConnection', { id: c.id })
            if (sugRes.ok && sugRes.value) {
              const sug = sugRes.value as { engine?: string; name?: string; port?: number; host?: string; database?: string; username?: string }
              if (sug.engine === 'postgres' || sug.engine === 'mongodb') {
                const engineLabel = sug.engine === 'postgres' ? 'PostgreSQL' : 'MongoDB'
                found.push({
                  id: c.id,
                  name: sug.name ?? c.name,
                  engine: sug.engine,
                  engineLabel,
                  port: sug.port ?? (sug.engine === 'postgres' ? 5432 : 27017),
                  suggestion: sugRes.value as Record<string, unknown>
                })
              }
            }
          } catch {
            // Per-container suggestion failure is ignored
          }
        }

        if (!active) return
        if (found.length === 0) {
          setContainers([])
          setDisabledReason(t('form.noContainersRunning'))
        } else {
          setContainers(found)
          setDisabledReason(null)
        }
      } catch {
        if (active) {
          setContainers([])
          setDisabledReason(t('form.dockerNotRunning'))
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadContainers()
    return () => { active = false }
  }, [t])

  const canUseContainers = !loading && containers.length > 0 && !disabledReason

  return (
    <div className="oq-container-picker-section">
      <div className="oq-source-radiogroup" role="radiogroup" aria-label={t('form.source')}>
        <button
          type="button"
          role="radio"
          aria-checked={source === 'details'}
          className="oq-source-radio"
          data-selected={source === 'details'}
          onClick={() => onSourceChange('details')}
        >
          {t('form.sourceDetails')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={source === 'container'}
          disabled={!canUseContainers}
          className="oq-source-radio"
          data-selected={source === 'container'}
          onClick={() => { if (canUseContainers) onSourceChange('container') }}
        >
          {t('form.sourceContainer')}
        </button>
      </div>

      {disabledReason && (
        <p className="oq-container-picker-reason">{disabledReason}</p>
      )}

      {source === 'container' && (
        <div className="oq-form-group">
          <label htmlFor="oq-container-select" className="oq-form-wide">
            {t('form.containerLabel')}
            <select
              id="oq-container-select"
              aria-label={t('form.containerLabel')}
              value={selectedId}
              onChange={event => {
                const target = containers.find(c => c.id === event.target.value)
                if (target) onSelect(target)
              }}
            >
              <option value="">{t('form.containerSelectPlaceholder')}</option>
              {containers.map(c => (
                <option key={c.id} value={c.id}>
                  {t('form.containerPort', { name: c.name, engine: c.engineLabel, port: c.port })}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
