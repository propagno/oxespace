// Per-source byte attribution of a bundle through its source map. Usage: node attr.mjs <bundle.js> <out.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(process.cwd() + '/package.json')
const { SourceMapConsumer } = require('source-map-js')
const [file, out] = process.argv.slice(2)
const code = readFileSync(file, 'utf8')
const map = new SourceMapConsumer(JSON.parse(readFileSync(file + '.map', 'utf8')))
const lines = code.split('\n')
const sizes = {}
const marks = []
map.eachMapping(m => marks.push(m), null, SourceMapConsumer.GENERATED_ORDER)
let covered = 0
for (let i = 0; i < marks.length; i++) {
  const m = marks[i], n = marks[i + 1]
  const line = lines[m.generatedLine - 1] ?? ''
  const end = n && n.generatedLine === m.generatedLine ? n.generatedColumn : line.length + 1
  const bytes = Buffer.byteLength(line.slice(m.generatedColumn, end))
  const src = (m.source || '<none>').replace(/^.*?(node_modules\/|electron\/|shared\/|src\/)/, '$1')
  sizes[src] = (sizes[src] || 0) + bytes
  covered += bytes
}
writeFileSync(out, JSON.stringify({ total: Buffer.byteLength(code), covered, sizes }))
console.log(file, 'total', Buffer.byteLength(code), 'covered', covered)
