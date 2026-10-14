import type { ReactElement } from 'react'
import type { ThreadCostReport } from '../../../shared/types/thread'
import { repairLegacyCost } from '../../../shared/threadCostRepair'

const compact = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(Math.round(n)))

export function formatThreadCost(usd: number): string {
  if (usd <= 0) return 'US$ 0.00'
  if (usd < 0.01) return 'US$ <0.01'
  return `US$ ${usd.toFixed(2)}`
}

/**
 * Running cost of the conversation, as the provider reports it. For a
 * subscription account this is the API-equivalent value, not a charge, so the
 * chip says "≈" and the tooltip says what it is.
 */
export function ThreadCostChip({ cost: stored }: { cost?: ThreadCostReport }): ReactElement | null {
  const cost = repairLegacyCost(stored)
  if (!cost || cost.totalUsd <= 0) return null
  const parts = [
    `Estimativa equivalente à API, acumulada em ${cost.turns} ${cost.turns === 1 ? 'turno' : 'turnos'}. Não é uma cobrança.`,
    cost.lastTurnUsd !== undefined ? `Último turno: ${formatThreadCost(cost.lastTurnUsd)}` : '',
    cost.inputTokens !== undefined ? `Entrada: ${compact(cost.inputTokens)} tokens` : '',
    cost.outputTokens !== undefined ? `Saída: ${compact(cost.outputTokens)} tokens` : '',
    cost.cacheReadTokens !== undefined ? `Cache lido: ${compact(cost.cacheReadTokens)} tokens` : ''
  ].filter(Boolean)
  return (
    <span className="thread-cost-chip" title={parts.join('\n')} aria-label={`Custo estimado ${formatThreadCost(cost.totalUsd)}`}>
      ≈ {formatThreadCost(cost.totalUsd)}
    </span>
  )
}
