#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const resultsDir = join(root, 'tests', 'token-bench', 'results')
const candidates = readdirSync(resultsDir)
  .filter((name) => /^eval-.*\.json$/.test(name))
  .sort()
  .reverse()
const file = candidates.find((name) => JSON.parse(readFileSync(join(resultsDir, name), 'utf8')).hybrid)
if (!file) throw new Error('No hybrid semantic evaluation found. Run npm run bench:semantic first.')

const result = JSON.parse(readFileSync(join(resultsDir, file), 'utf8'))
const failures = []
if (result.queries < 10) failures.push(`query set too small (${result.queries} < 10)`)
if (result.corpus < 300) failures.push(`corpus too small (${result.corpus} < 300)`)
if (result.hybrid.recall5 < result.chunked.recall5) failures.push(`hybrid Recall@5 regressed (${result.hybrid.recall5} < ${result.chunked.recall5})`)
if (result.hybrid.mrr < result.chunked.mrr * 0.9) failures.push(`hybrid MRR regressed by more than 10% (${result.hybrid.mrr} vs ${result.chunked.mrr})`)
if (result.hybrid.meanCtx > 6_000) failures.push(`mean context budget exceeded (${Math.round(result.hybrid.meanCtx)} > 6000 tokens)`)

if (failures.length > 0) {
  process.stderr.write(`Semantic quality gate FAILED (${file})\n- ${failures.join('\n- ')}\n`)
  process.exit(1)
}
process.stdout.write(`Semantic quality gate PASSED (${file}) · Recall@5 ${(result.hybrid.recall5 * 100).toFixed(0)}% · MRR ${result.hybrid.mrr.toFixed(3)} · mean context ${Math.round(result.hybrid.meanCtx)} tokens\n`)

