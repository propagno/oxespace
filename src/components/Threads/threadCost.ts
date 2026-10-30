import { formatNumber } from '../../utils/formatTime'

const usd = (value: number): string => `US$ ${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** A cost in US dollars, with the decimal mark of the interface language. */
export function formatThreadCost(value: number): string {
  if (value <= 0) return usd(0)
  if (value < 0.01) return `US$ <${formatNumber(0.01, { minimumFractionDigits: 2 })}`
  return usd(value)
}
