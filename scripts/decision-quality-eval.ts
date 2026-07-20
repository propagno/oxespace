/**
 * Decision-quality analysis — does oxespace_hybrid_explore AMPLIFY decisions or
 * hide crucial information? Objective, reproducible metrics on THIS repo.
 *
 *   Exp 1 — Blast-radius completeness: for distinctive symbols, compare the files
 *           CodeGraph surfaces (index callers + what `codegraph_explore` shows)
 *           against ground-truth references (git grep). Recall + what's missed.
 *   Exp 2 — Change-set sufficiency: real multi-file git commits as ground truth;
 *           does hybrid / semantic / grep surface ALL files the change touched?
 *   Exp 3 — Failure-mode catalog: concrete real instances (tests, config, cap).
 *
 * Run:  npx tsx scripts/decision-quality-eval.ts
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
process.env.CODEGRAPH_ASSET_DIR = path.join(ROOT, 'out', 'main')
const RESULTS = path.join(ROOT, 'tests', 'token-bench', 'results')
const SCAN = ['electron', 'src', 'shared']
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const ALL_TEXT_EXT = new Set([...CODE_EXT, '.json', '.yml', '.yaml', '.md', '.sql', '.css', '.html'])
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/')
const log = (...a: any[]) => process.stderr.write(a.join(' ') + '\n')

function git(args: string[]): string {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) } catch { return '' }
}
// Ground-truth references: tracked files containing the symbol as a whole word.
function gitGrepFiles(symbol: string): string[] {
  try {
    const out = execFileSync('git', ['grep', '-l', '-w', '-F', symbol, '--', '*.*'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return out.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => s.split(path.sep).join('/'))
  } catch { return [] } // git grep exits 1 when no matches
}
function classify(p: string): 'test' | 'config' | 'source' {
  if (/\.(test|spec)\.[tj]sx?$/.test(p) || /(^|\/)tests?\//.test(p) || /(^|\/)e2e\//.test(p)) return 'test'
  if (/\.(json|ya?ml|md|sql|css|html)$/.test(p)) return 'config'
  return 'source'
}
function pathsInText(text: string): Set<string> {
  const set = new Set<string>()
  const re = /([A-Za-z0-9_./-]+\.(?:tsx?|jsx?|mjs|cjs|json|ya?ml|md|sql|css|html))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const p = m[1].replace(/^\.\//, '')
    if (/(^|\/)(electron|src|shared|scripts|tests|resources|e2e)\//.test(p) || /^(package|tsconfig|electron-builder)/.test(p)) set.add(p)
  }
  return set
}
const recall = (got: Set<string>, gt: string[]) => (gt.length === 0 ? null : gt.filter((f) => got.has(f)).length / gt.length)
const pct = (x: number | null) => (x === null ? 'n/a' : (x * 100).toFixed(0) + '%')
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

// ---------- CodeGraph ----------
process.stderr.write('[dq] opening codegraph …\n')
const CGmod = await import('../electron/main/vendor/codegraph/index.ts')
const CG: any = (CGmod as any).default ?? CGmod
const { isInitialized } = await import('../electron/main/vendor/codegraph/directory.ts')
const { ToolHandler } = await import('../electron/main/vendor/codegraph/mcp/tools.ts')
if (!isInitialized(ROOT)) await CG.init(ROOT, { index: true })
const cg = await CG.open(ROOT, { sync: false })
const cgh = new ToolHandler(cg)
const DEF_KINDS = new Set(['function', 'class', 'method', 'interface', 'type_alias', 'variable', 'constant', 'enum'])
const explore = async (q: string, maxFiles?: number) => {
  try { const r = await cgh.execute('codegraph_explore', maxFiles ? { query: q, maxFiles } : { query: q }); return (r?.content?.[0]?.text as string) ?? '' } catch { return '' }
}

// =================== EXP 1 — blast-radius completeness ===================
const SYMBOLS = [
  'SemanticService', 'bestChunkScore', 'makeIgnoreFilter', 'rebindServerRow', 'loadOrCreateMeta',
  'McpConfigSync', 'chunkText', 'cosineSimilarity', 'ensureServerRow', 'RtkService',
  'ShellProfileService', 'getCodeGraphDir', 'createLocalRpcServer', 'WorktreeEventBus', 'WebPreviewBus',
  'serializeConfig', 'TerminalManager', 'CodeGraphService'
]
log('[dq] Exp1: blast-radius completeness …')
type E1 = { sym: string; gt: number; idxRecall: number | null; viewRecall: number | null; missTest: number; missConfig: number; missSource: number }
const e1: E1[] = []
for (const sym of SYMBOLS) {
  const defNodes = (cg.getNodesByName(sym) as any[]).filter((n) => DEF_KINDS.has(n.kind))
  if (defNodes.length === 0) { log(`  ${sym}: no def node, skip`); continue }
  const defFiles = new Set(defNodes.map((n) => rel(n.filePath)))
  const gt = gitGrepFiles(sym).filter((f) => !defFiles.has(f))
  // index callers (calls edges)
  const idx = new Set<string>()
  for (const n of defNodes) for (const c of cg.getCallers(n.id, 1) as any[]) idx.add(rel(c.node.filePath))
  // what the agent actually sees in explore()
  const view = pathsInText(await explore(sym))
  const misses = gt.filter((f) => !view.has(f))
  e1.push({
    sym, gt: gt.length,
    idxRecall: recall(idx, gt), viewRecall: recall(view, gt),
    missTest: misses.filter((f) => classify(f) === 'test').length,
    missConfig: misses.filter((f) => classify(f) === 'config').length,
    missSource: misses.filter((f) => classify(f) === 'source').length
  })
  log(`  ${sym}: GT=${gt.length} idxRecall=${pct(recall(idx, gt))} viewRecall=${pct(recall(view, gt))}`)
}

// =================== EXP 2 — change-set sufficiency ===================
log('[dq] Exp2: embedding corpus for semantic …')
const files: string[] = []
;(function walk(d: string) { let e; try { e = readdirSync(d, { withFileTypes: true }) } catch { return } for (const x of e) { if (x.name.startsWith('.') || ['node_modules', 'dist', 'out', 'build', 'coverage'].includes(x.name)) continue; const f = path.join(d, x.name); if (x.isDirectory()) walk(f); else if (CODE_EXT.has(path.extname(x.name)) && statSync(f).size < 256 * 1024) files.push(f) } })(path.join(ROOT))
const { pipeline, env } = await import('@xenova/transformers')
env.allowRemoteModels = true; (env as any).cacheDir = path.join(ROOT, 'resources', 'models')
const ex = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true })
const embed = async (t: string) => Array.from((await ex(t, { pooling: 'mean', normalize: true })).data) as number[]
const CH = 1500, OV = 200, MX = 60
const chunk = (t: string) => { if (t.length <= CH) return t ? [t] : []; const s = CH - OV, o: string[] = []; for (let i = 0; i < t.length && o.length < MX; i += s) o.push(t.slice(i, i + CH)); return o }
const cos = (a: number[], b: number[]) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] } return na && nb ? d / Math.sqrt(na * nb) : 0 }
const recs: { rel: string; vecs: number[][] }[] = []
for (const f of files) { let c; try { c = readFileSync(f, 'utf8') } catch { continue } if (!c.trim()) continue; const vv: number[][] = []; for (const ck of chunk(c)) vv.push(await embed('passage: ' + ck)); if (vv.length) recs.push({ rel: rel(f), vecs: vv }) }
log(`[dq] embedded ${recs.length} files`)
const semanticTop = async (q: string, k: number) => { const qv = await embed('query: ' + q); return recs.map((r) => ({ rel: r.rel, s: Math.max(...r.vecs.map((v) => cos(qv, v))) })).sort((a, b) => b.s - a.s).slice(0, k).map((r) => r.rel) }
const STOP = new Set(['fix', 'feat', 'chore', 'the', 'and', 'for', 'with', 'use', 'add', 'when', 'into', 'from', 'que', 'com', 'para'])
const keywords = (s: string) => [...new Set((s.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []).filter((w) => !STOP.has(w)))].slice(0, 6)
const grepFiles = (kws: string[]) => { const set = new Set<string>(); for (const k of kws) for (const f of gitGrepFiles(k)) if (CODE_EXT.has(path.extname(f))) set.add(f); return set }

// sample real multi-file commits
const logRaw = git(['log', '--no-merges', '-n', '200', '--pretty=format:%H\x1f%s'])
type Commit = { sha: string; subj: string; files: string[] }
const commits: Commit[] = []
for (const line of logRaw.split('\n')) {
  const [sha, subj] = line.split('\x1f'); if (!sha || !subj) continue
  if (/release|bump|version|changelog|^docs|readme|merge/i.test(subj)) continue
  const changed = git(['show', '--name-only', '--pretty=format:', sha]).split('\n').map((s) => s.trim()).filter(Boolean).map((s) => s.split(path.sep).join('/')).filter((f) => CODE_EXT.has(path.extname(f)))
  const uniq = [...new Set(changed)]
  if (uniq.length >= 2 && uniq.length <= 8) commits.push({ sha: sha.slice(0, 8), subj, files: uniq })
  if (commits.length >= 25) break
}
log(`[dq] Exp2: ${commits.length} multi-file commits`)
type E2 = { strat: string; suff: number; recall: number }
const acc: Record<string, { suff: number[]; rec: number[] }> = { hybrid: { suff: [], rec: [] }, 'semantic@5': { suff: [], rec: [] }, 'semantic@10': { suff: [], rec: [] }, grep: { suff: [], rec: [] } }
for (const c of commits) {
  const gt = c.files.filter((f) => recs.some((r) => r.rel === f) || true) // GT = changed code files
  const sem3 = await semanticTop(c.subj, 3)
  const hybrid = new Set<string>([...sem3, ...pathsInText(await explore(c.subj))])
  const sem5 = new Set(await semanticTop(c.subj, 5))
  const sem10 = new Set(await semanticTop(c.subj, 10))
  const grep = grepFiles(keywords(c.subj))
  const score = (got: Set<string>) => { const hit = gt.filter((f) => got.has(f)).length; return { suff: hit === gt.length ? 1 : 0, rec: gt.length ? hit / gt.length : 1 } }
  for (const [name, got] of [['hybrid', hybrid], ['semantic@5', sem5], ['semantic@10', sem10], ['grep', grep]] as [string, Set<string>][]) {
    const s = score(got); acc[name].suff.push(s.suff); acc[name].rec.push(s.rec)
  }
}
const e2: E2[] = Object.entries(acc).map(([strat, v]) => ({ strat, suff: mean(v.suff), recall: mean(v.rec) }))

// =================== EXP 3 — failure-mode instances ===================
log('[dq] Exp3: failure-mode instances …')
const e3: { mode: string; detail: string }[] = []
// test exclusion
{
  const sym = 'chunkText'
  const plain = pathsInText(await explore(sym))
  const withTest = pathsInText(await explore(sym + ' test'))
  const gtTests = gitGrepFiles(sym).filter((f) => classify(f) === 'test')
  e3.push({ mode: 'Test files excluded (no "test" in query)', detail: `${sym}: GT test files=${gtTests.length}; explore("${sym}") shows ${[...plain].filter((f) => classify(f) === 'test').length}; explore("${sym} test") shows ${[...withTest].filter((f) => classify(f) === 'test').length}` })
}
// config not indexed
{
  const term = 'better-sqlite3'
  const gt = gitGrepFiles(term)
  const view = pathsInText(await explore(term))
  const cfgGt = gt.filter((f) => classify(f) === 'config')
  e3.push({ mode: 'Config/JSON/YAML not indexed', detail: `"${term}": referenced in ${cfgGt.length} config files (${cfgGt.slice(0, 3).join(', ')}); explore surfaces ${[...view].filter((f) => classify(f) === 'config').length} of them` })
}
// cap on large blast radius (pick the symbol with the most GT refs from Exp1)
{
  const top = [...e1].sort((a, b) => b.gt - a.gt)[0]
  if (top) e3.push({ mode: 'Blast-radius cap (large fan-in)', detail: `${top.sym}: ${top.gt} real reference files; explore shows ${pct(top.viewRecall)} of them` })
}
// homonyms
{
  for (const name of ['query', 'start', 'stop', 'destroy']) {
    const defs = (cg.getNodesByName(name) as any[]).filter((n) => DEF_KINDS.has(n.kind))
    const fileset = new Set(defs.map((n: any) => rel(n.filePath)))
    if (fileset.size >= 2) { e3.push({ mode: 'Same-name symbol collision', detail: `"${name}" is defined in ${fileset.size} files (${[...fileset].slice(0, 3).join(', ')}…) — explore must guess which one's callers to show` }); break }
  }
}

// =================== REPORT ===================
const avgIdx = mean(e1.filter((r) => r.idxRecall !== null).map((r) => r.idxRecall as number))
const avgView = mean(e1.filter((r) => r.viewRecall !== null).map((r) => r.viewRecall as number))
const totMiss = e1.reduce((a, r) => ({ t: a.t + r.missTest, c: a.c + r.missConfig, s: a.s + r.missSource }), { t: 0, c: 0, s: 0 })
let md = `# Decision-quality analysis — hybrid_explore: amplifica ou esconde info crucial?\n\n`
md += `Repo: oxespace · Modelo semantic: multilingual-e5-small · CodeGraph: real · ground-truth: \`git grep -w\` + git history\n\n`
md += `## Exp 1 — Completude do "blast radius" (${e1.length} símbolos distintivos)\n\n`
md += `Recall = quantos arquivos que REALMENTE referenciam o símbolo aparecem. "Índice" = callers no grafo (edges \`calls\`). "Apresentado" = o que o \`codegraph_explore\` mostra ao agente.\n\n`
md += `| Símbolo | Refs reais (GT) | Recall índice (calls) | Recall apresentado | Misses: teste/config/source |\n|---|--:|--:|--:|--:|\n`
for (const r of e1) md += `| \`${r.sym}\` | ${r.gt} | ${pct(r.idxRecall)} | ${pct(r.viewRecall)} | ${r.missTest}/${r.missConfig}/${r.missSource} |\n`
md += `| **Média** | | **${pct(avgIdx)}** | **${pct(avgView)}** | **${totMiss.t}/${totMiss.c}/${totMiss.s}** |\n\n`
md += `> "Recall índice (calls)" é baixo por design: \`getCallers\` segue só chamadas de função, não imports/uso-de-tipo. O número que importa para a decisão é o **recall apresentado** (o que o agente vê).\n\n`
md += `## Exp 2 — Suficiência vs. mudanças reais do git (${commits.length} commits multi-arquivo)\n\n`
md += `Suficiência = % de commits onde TODOS os arquivos alterados apareceram no contexto. Recall = fração média dos arquivos do commit recuperada.\n\n`
md += `| Estratégia | Suficiência (todos) | Recall médio de arquivos |\n|---|--:|--:|\n`
for (const r of e2) md += `| ${r.strat} | ${pct(r.suff)} | ${pct(r.recall)} |\n`
md += `\nCommits amostrados: ${commits.map((c) => c.sha).join(', ')}\n\n`
md += `## Exp 3 — Modos de falha com instâncias reais\n\n| Modo de falha | Instância concreta neste repo |\n|---|---|\n`
for (const r of e3) md += `| ${r.mode} | ${r.detail} |\n`
md += `\n## Veredito\n\n`
md += `- **Navegação / entendimento** ("como X funciona", "onde está Y"): o hybrid **amplifica** — leva ao código certo com fração dos tokens (−58% a −97% já medido) e recall apresentado de **${pct(avgView)}** nos símbolos testados.\n`
md += `- **Refactor / completude** ("achar TODOS os callers"): é **best-effort**. Em média deixa de mostrar referências reais — principalmente **testes (${totMiss.t})** e **config/JSON/YAML (${totMiss.c})**, que ele não indexa, além de ${totMiss.s} em código por cap/resolução. Confiar nele como lista exaustiva pode levar a decisões incompletas.\n`
md += `- **Conclusão**: amplifica como PONTO DE PARTIDA; para mudanças que exigem exaustividade, deve ser combinado com \`grep\` (o agente mantém esse acesso). O risco real é **over-trust** numa lista que se apresenta como completa sem ressalva.\n\n`
md += `## Mitigações recomendadas (fora desta análise)\n`
md += `1. Descrição honesta da tool: "explore primeiro; para refactor/rename, confirme a lista com grep".\n2. Indexar \`.json/.yaml\` no CodeGraph (config-driven wiring).\n3. Incluir arquivos de teste por padrão (ou sinalizar que foram omitidos).\n4. Emitir sinal explícito quando a saída foi truncada por cap.\n5. Hybrid: subir top-3→top-5 e/ou avaliar e5-base para elevar o recall semântico.\n`

mkdirSync(RESULTS, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(path.join(RESULTS, `decision-quality-${stamp}.md`), md)
writeFileSync(path.join(RESULTS, `decision-quality-${stamp}.json`), JSON.stringify({ e1, e2, commits, e3 }, null, 2))
process.stdout.write(md + `\nSaved decision-quality-${stamp}.{md,json}\n`)
process.exit(0)
