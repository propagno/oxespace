import { readFileSync } from 'node:fs'
const [a, b] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, 'utf8')))
console.log('base total', a.total, 'head total', b.total, 'delta', b.total - a.total)
const keys = new Set([...Object.keys(a.sizes), ...Object.keys(b.sizes)])
const rows = [...keys].map(k => [k, (b.sizes[k] || 0) - (a.sizes[k] || 0), a.sizes[k] || 0, b.sizes[k] || 0]).filter(r => r[1] !== 0).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
for (const r of rows.slice(0, 70)) console.log(String(r[1]).padStart(7), String(r[2]).padStart(7), String(r[3]).padStart(7), r[0])
const added = rows.filter(r => !a.sizes[r[0]])
console.log('--- sources new in head:', added.length)
for (const r of added.slice(0, 60)) console.log(String(r[1]).padStart(7), r[0])
