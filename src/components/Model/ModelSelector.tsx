import { Cpu, Check, Sparkles, Zap, Gauge, X } from 'lucide-react'
import { useMemo, type ReactElement } from 'react'
import type { AgentProvider } from '../../../shared/types/agent'
import { MODEL_REGISTRY, type ModelDefinition } from '../../../shared/types/model'

interface ModelSelectorProps {
  paneId: string
  paneLabel: string
  provider: AgentProvider | null
  currentModelId: string | null
  onSelect: (paneId: string, modelId: string | null) => void
  onClose: () => void
}

export function ModelSelector({ paneId, paneLabel, provider, currentModelId, onSelect, onClose }: ModelSelectorProps): ReactElement {
  const models = useMemo(() => {
    if (!provider) return []
    return MODEL_REGISTRY.filter((m) => m.provider === provider)
  }, [provider])

  const groupedModels = useMemo(() => {
    const map = new Map<ModelDefinition['tier'], ModelDefinition[]>()
    for (const m of models) {
      const arr = map.get(m.tier) ?? []
      arr.push(m)
      map.set(m.tier, arr)
    }
    return map
  }, [models])

  const tierOrder: ModelDefinition['tier'][] = ['flagship', 'balanced', 'fast']
  const TIER_META: Record<ModelDefinition['tier'], { label: string; Icon: typeof Sparkles }> = {
    flagship: { label: 'Flagship', Icon: Sparkles },
    balanced: { label: 'Balanced', Icon: Gauge },
    fast: { label: 'Fast', Icon: Zap }
  }

  const handleSelect = (modelId: string): void => {
    onSelect(paneId, modelId)
    onClose()
  }

  const handleReset = (): void => {
    onSelect(paneId, null)
    onClose()
  }

  return (
    <div className="model-selector-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="model-selector"
        role="dialog"
        aria-modal="true"
        aria-label={`Selecionar modelo para ${paneLabel}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="model-selector-header">
          <div className="model-selector-title">
            <Cpu size={14} aria-hidden="true" />
            <strong>Modelo de IA</strong>
            <span className="model-selector-pane">{paneLabel}</span>
          </div>
          <button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        {models.length === 0 ? (
          <div className="model-selector-empty">
            <Cpu size={32} aria-hidden="true" />
            <strong>Modelo não pode ser trocado aqui</strong>
            <span>O provider <code>{provider ?? '—'}</code> não expõe seleção de modelo via CLI.</span>
            <span className="model-selector-empty-hint">Para trocar, ajuste o agente nas configurações.</span>
          </div>
        ) : (
          <>
            <div className="model-selector-list">
              {tierOrder.map((tier) => {
                const tierModels = groupedModels.get(tier)
                if (!tierModels || tierModels.length === 0) return null
                const { label, Icon } = TIER_META[tier]
                return (
                  <section key={tier} className="model-selector-tier">
                    <header className="model-selector-tier-header">
                      <Icon size={11} aria-hidden="true" />
                      <span>{label}</span>
                    </header>
                    {tierModels.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`model-selector-item${currentModelId === m.id ? ' active' : ''}`}
                        onClick={() => handleSelect(m.id)}
                        aria-pressed={currentModelId === m.id}
                      >
                        <div className="model-selector-item-main">
                          <strong>{m.label}</strong>
                          <span>{m.hint}</span>
                          <div className="model-selector-item-meta">
                            <span className="model-meta-chip">{formatContext(m.contextLimit)}</span>
                            {m.inputCostPerMTok ? (
                              <span className="model-meta-chip">${m.inputCostPerMTok}/M in</span>
                            ) : null}
                            {m.outputCostPerMTok ? (
                              <span className="model-meta-chip">${m.outputCostPerMTok}/M out</span>
                            ) : null}
                          </div>
                        </div>
                        {currentModelId === m.id ? (
                          <div className="model-selector-item-check">
                            <Check size={14} aria-hidden="true" />
                          </div>
                        ) : null}
                      </button>
                    ))}
                  </section>
                )
              })}
            </div>

            <footer className="model-selector-footer">
              {currentModelId ? (
                <button type="button" className="model-selector-reset" onClick={handleReset}>
                  Limpar override
                </button>
              ) : (
                <span className="model-selector-default-hint">Usando o modelo padrão do agente</span>
              )}
              <span className="model-selector-warning">A troca exige restart do pane</span>
            </footer>
          </>
        )}
      </section>
    </div>
  )
}

function formatContext(limit: number): string {
  if (limit >= 1_000_000) return `${(limit / 1_000_000).toFixed(0)}M ctx`
  if (limit >= 1_000) return `${(limit / 1_000).toFixed(0)}k ctx`
  return `${limit} ctx`
}
