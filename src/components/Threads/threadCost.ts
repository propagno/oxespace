export function formatThreadCost(usd: number): string {
  if (usd <= 0) return 'US$ 0.00'
  if (usd < 0.01) return 'US$ <0.01'
  return `US$ ${usd.toFixed(2)}`
}
