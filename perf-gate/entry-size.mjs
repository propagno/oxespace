// The renderer entry chunk of a built app (OXE-105 release gate): the module script out/renderer/index.html loads.
// Usage: node perf-gate/entry-size.mjs <app checkout> > <side>-entry.json
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = join(process.argv[2] || '.', 'out', 'renderer')
const html = readFileSync(join(root, 'index.html'), 'utf8')
const src = (html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/) || html.match(/<script[^>]*src="([^"]+)"[^>]*type="module"/) || [])[1]
if (!src) { console.error('no module script in out/renderer/index.html'); process.exit(1) }
const file = join(root, src.replace(/^\.?\//, ''))
const bytes = statSync(file).size
console.log(JSON.stringify({ file: src, bytes, gzipBytes: gzipSync(readFileSync(file), { level: 9 }).length }))
