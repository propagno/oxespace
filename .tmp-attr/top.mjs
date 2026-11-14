import { readFileSync } from 'node:fs'
const d = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const n = Number(process.argv[3] || 400)
console.log('total', d.total, 'covered', d.covered)
const rows = Object.entries(d.sizes).sort((a, b) => b[1] - a[1])
for (const [k, v] of rows.slice(0, n)) console.log(String(v).padStart(7), k)
const dirs = {}
for (const [k, v] of rows) { const p = k.split('/').slice(0, 4).join('/'); dirs[p] = (dirs[p] || 0) + v }
console.log('--- by dir')
for (const [k, v] of Object.entries(dirs).sort((a, b) => b[1] - a[1]).slice(0, 80)) console.log(String(v).padStart(7), k)
