// Reads `[AB]` lines (argv[2]) and prints, per metric: per side the median and p90 of the round values (each round's
// value = median of its measured launches), and B − A as the median of the paired round differences with a 95%
// bootstrap interval. Within noise = the interval contains 0, or its upper end is under 5% of A's median.
import { readFileSync } from 'node:fs'

const label = process.argv[3] || ''
const lines = readFileSync(process.argv[2], 'utf8').split('\n').filter(line => line.includes('[AB]') && line.includes('warmup=0'))
const rows = lines.map(line => Object.fromEntries([...line.matchAll(/(\w+)=([^\s]+)/g)].map(m => [m[1], m[2]])))
const median = xs => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN }
const quantile = (xs, q) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return NaN; const pos = (s.length - 1) * q; const lo = Math.floor(pos); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo) }
let seed = 42
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

const out = [`## Boot A/B ${label}`, '', 'A = main · B = main + #798 + #799 · round value = median of its measured launches', '']
for (const metric of ['interactive', 'firstPaint']) {
  const byRound = { A: {}, B: {} }
  for (const row of rows) {
    const value = Number(row[metric])
    if (!Number.isFinite(value)) continue
    ;(byRound[row.side][row.round] ??= []).push(value)
  }
  const rounds = Object.keys(byRound.A).filter(r => byRound.B[r])
  const a = rounds.map(r => median(byRound.A[r]))
  const b = rounds.map(r => median(byRound.B[r]))
  const d = rounds.map((_, i) => b[i] - a[i])
  const boots = []
  for (let k = 0; k < 5000; k++) boots.push(median(d.map(() => d[Math.floor(rand() * d.length)])))
  const lo = quantile(boots, 0.025), hi = quantile(boots, 0.975), mA = median(a)
  const noise = (lo <= 0 && hi >= 0) || hi < 0.05 * mA
  const name = metric === 'interactive' ? 'process→interactive' : 'window→first paint'
  out.push(`- **${name}** (${rounds.length} rounds): A median ${mA.toFixed(0)} p90 ${quantile(a, 0.9).toFixed(0)} ms · B median ${median(b).toFixed(0)} p90 ${quantile(b, 0.9).toFixed(0)} ms · B − A ${median(d).toFixed(0)} ms, 95% [${lo.toFixed(0)}, ${hi.toFixed(0)}] → ${noise ? 'within noise' : 'B slower than noise'}`)
  out.push(`  - rounds A: ${a.map(x => x.toFixed(0)).join(' ')} · B: ${b.map(x => x.toFixed(0)).join(' ')}`)
}
console.log(out.join('\n'))
