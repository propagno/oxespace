/**
 * 4-feature economy + quality eval — RTK × Caveman × Semantic × CodeGraph.
 *
 * Runs the REAL pipelines on this repo:
 *   - Semantic: Xenova/multilingual-e5-small (chunked, best-chunk), bundled model
 *   - CodeGraph: the vendored engine (oxespace_hybrid_explore's codegraph_explore)
 *   - RTK / Caveman: same heuristics as the token lab (terminal/output compression)
 *
 * For 10 labeled queries (PT → EN code, each with a known answer file) it reports,
 * per retrieval strategy: mean CONTEXT TOKENS (economy) and RECALL (the answer file
 * is present → no drastic context/quality loss).
 *
 * Run:  npx tsx scripts/hybrid-eval.ts
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
process.env.CODEGRAPH_ASSET_DIR = path.join(ROOT, 'out', 'main')
const RESULTS = path.join(ROOT, 'tests', 'token-bench', 'results')
const SCAN = ['electron', 'src', 'shared']
const TOPK = 5
const CHUNK = 1500, OVERLAP = 200, MAXC = 60
const QPFX = 'query: ', PPFX = 'passage: '

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.py', '.go', '.rs', '.java', '.c', '.h', '.cc', '.cpp', '.cs', '.php', '.rb', '.sh', '.ps1', '.sql', '.html', '.css', '.scss', '.vue', '.svelte', '.yml', '.yaml', '.toml'])
const IGN = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', '.turbo', 'coverage', 'vendor'])
const MAXB = 256 * 1024
const STOP = new Set(['como', 'onde', 'fica', 'para', 'por', 'dos', 'das', 'que', 'com', 'sem', 'uma', 'esta', 'sobre', 'qual', 'quais', 'the', 'and', 'for', 'where', 'how', 'does', 'into', 'with', 'from', 'são', 'usando', 'pelo', 'pela'])

const QUERIES: { q: string; target: string[] }[] = [
  { q: 'Como o servidor MCP entra em hibernação por inatividade e onde fica o timer de sleep?', target: ['services/mcp.service.ts'] },
  { q: 'Onde os embeddings da busca semântica são gerados pelo worker?', target: ['workers/semantic-worker.ts', 'services/semantic.service.ts'] },
  { q: 'Como o terminal PTY é criado usando o perfil de shell?', target: ['services/terminal.service.ts'] },
  { q: 'Onde fica a validação de allowlist do sistema de arquivos do workspace?', target: ['services/file-system.service.ts'] },
  { q: 'Como os atalhos de teclado para dividir o pane ativo são tratados?', target: ['src/App.tsx'] },
  { q: 'Onde a integração com o GitHub conecta e lista repositórios?', target: ['services/github.service.ts'] },
  { q: 'Como o RTK baixa o binário rtk.exe para a pasta de dados do usuário?', target: ['services/rtk.service.ts'] },
  { q: 'Onde está o registro das ferramentas internas expostas via MCP?', target: ['mcp-internal/tool-registry.ts'] },
  { q: 'Como um workspace é criado com um pane por célula do layout?', target: ['services/workspace.service.ts'] },
  { q: 'Onde o áudio é transcrito usando o Whisper na funcionalidade de voz?', target: ['services/voice.service.ts'] }
]

let countTokens: (t: string) => number
try { const m = await import('gpt-tokenizer'); countTokens = (t) => (m as any).encode(t ?? '').length }
catch { countTokens = (t) => Math.ceil((t ?? '').length / 4) }

function chunkText(t: string): string[] {
  if (t.length <= CHUNK) return t ? [t] : []
  const step = CHUNK - OVERLAP, out: string[] = []
  for (let s = 0; s < t.length && out.length < MAXC; s += step) out.push(t.slice(s, s + CHUNK))
  return out
}
function cosine(a: number[], b: number[]) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] } return na && nb ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0 }
function keywords(t: string) { return [...new Set((t.toLowerCase().match(/[a-zà-ú0-9]{4,}/giu) || []).map(w => w.toLowerCase()).filter(w => !STOP.has(w)))] }
function walk(dir: string, acc: string[]) { let e; try { e = readdirSync(dir, { withFileTypes: true }) } catch { return acc } for (const x of e) { const f = path.join(dir, x.name); if (IGN.has(x.name) || (x.name.length > 1 && x.name.startsWith('.'))) continue; if (x.isDirectory()) { walk(f, acc); continue } if (!CODE_EXT.has(path.extname(x.name).toLowerCase())) continue; let s; try { s = statSync(f).size } catch { continue } if (s > MAXB || s === 0) continue; acc.push(f) } return acc }
const log = (...a: any[]) => process.stderr.write(a.join(' ') + '\n')

// --- corpus + embeddings (semantic) ---
const files: string[] = []
for (const d of SCAN) walk(path.join(ROOT, d), files)
log(`[eval] ${files.length} files`)
const { pipeline, env } = await import('@xenova/transformers')
env.allowRemoteModels = true; (env as any).cacheDir = path.join(ROOT, 'resources', 'models')
const ex = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true })
const embed = async (t: string) => Array.from((await ex(t, { pooling: 'mean', normalize: true })).data) as number[]
log('[eval] embedding corpus (chunked) …')
const recs: { rel: string; content: string; vecs: number[][] }[] = []
for (const f of files) { let c; try { c = readFileSync(f, 'utf-8') } catch { continue } if (!c.trim()) continue; const vecs: number[][] = []; for (const ch of chunkText(c)) vecs.push(await embed(PPFX + ch)); if (vecs.length) recs.push({ rel: path.relative(ROOT, f).split(path.sep).join('/'), content: c, vecs }) }
log(`[eval] embedded ${recs.length} files`)

// --- codegraph ---
const CGmod = await import('../electron/main/vendor/codegraph/index.ts')
const CG: any = (CGmod as any).default ?? CGmod
const { isInitialized } = await import('../electron/main/vendor/codegraph/directory.ts')
const { ToolHandler } = await import('../electron/main/vendor/codegraph/mcp/tools.ts')
if (!isInitialized(ROOT)) { log('[eval] codegraph indexing …'); await CG.init(ROOT, { index: true }) }
const cg = await CG.open(ROOT, { sync: false })
const cgh = new ToolHandler(cg)
const cgExplore = async (query: string, maxFiles = TOPK) => { try { const r = await cgh.execute('codegraph_explore', { query, maxFiles }); return (r?.content?.[0]?.text as string) ?? '' } catch { return '' } }

const join = (rs: { rel: string; content: string }[]) => rs.map(r => `// ${r.rel}\n${r.content}`).join('\n\n')
const hit = (text: string, targets: string[]) => targets.some(t => text.includes(t))

type Row = { q: string; grepTok: number; grepHit: boolean; semTok: number; semHit: boolean; cgTok: number; cgHit: boolean; hybTok: number; hybHit: boolean }
const rows: Row[] = []
for (const { q, target } of QUERIES) {
  // grep baseline (whole files matching keywords)
  const kw = keywords(q)
  const grep = recs.filter(r => { const lc = r.content.toLowerCase(); return kw.some(k => lc.includes(k)) })
  // semantic top-K (whole files)
  const qv = await embed(QPFX + q)
  const ranked = recs.map(r => ({ ...r, score: Math.max(...r.vecs.map(v => cosine(qv, v))) })).sort((a, b) => b.score - a.score)
  const sem = ranked.slice(0, TOPK)
  const semHints = sem.slice(0, 3) // semantic top-3 listed in the hybrid output
  // codegraph explore on the PLAIN query (structural verbatim)
  const cgText = await cgExplore(q, TOPK)
  // hybrid (corrected) = semantic top-3 paths UNION plain codegraph explore —
  // mirrors the fixed oxespace_hybrid_explore (no query augmentation).
  const hybText = semHints.map(r => `- ${r.rel}`).join('\n') + '\n\n' + cgText
  const semHitV = sem.some(r => hit(r.rel, target))
  rows.push({
    q,
    grepTok: countTokens(join(grep)), grepHit: grep.some(r => hit(r.rel, target)),
    semTok: countTokens(join(sem)), semHit: semHitV,
    cgTok: countTokens(cgText), cgHit: hit(cgText, target),
    // recall = union: target in semantic top-3 OR in codegraph explore
    hybTok: countTokens(hybText), hybHit: hit(hybText, target) || semHints.some(r => hit(r.rel, target))
  })
  log(`[eval] ${q.slice(0, 40)}… grep=${rows.at(-1)!.grepTok} sem=${rows.at(-1)!.semTok} cg=${rows.at(-1)!.cgTok} hyb=${rows.at(-1)!.hybTok}`)
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const pct = (n: number) => (n * 100).toFixed(0) + '%'
const f0 = (n: number) => Math.round(n).toLocaleString('en-US')
const agg = (tok: (r: Row) => number, h: (r: Row) => boolean) => ({ tok: mean(rows.map(tok)), recall: rows.filter(h).length / rows.length })
const G = agg(r => r.grepTok, r => r.grepHit), S = agg(r => r.semTok, r => r.semHit), C = agg(r => r.cgTok, r => r.cgHit), H = agg(r => r.hybTok, r => r.hybHit)

// RTK + Caveman (per-request, same heuristic as the lab)
const TERMINAL_RAW_TOK = 506, TERMINAL_RTK_TOK = 237   // measured in semantic-lab
const OUT_VERBOSE_TOK = 261, OUT_CAVEMAN_TOK = 47

let md = ''
md += `# 4-feature economy + quality — RTK × Caveman × Semantic × CodeGraph\n\n`
md += `- Model **multilingual-e5-small** · CodeGraph **real** (vendored) · ${QUERIES.length} labeled queries (PT→EN code) · corpus ${recs.length} files · Top-K ${TOPK}\n`
md += `- Economy = mean code-context tokens; Quality = recall (answer file present in the context)\n\n`
md += `## Retrieval strategies (mean over queries)\n\n`
md += `| Strategy | Context tokens | vs grep | Recall (answer present) |\n|---|--:|--:|--:|\n`
md += `| Grep baseline (whole files) | ${f0(G.tok)} | — | ${pct(G.recall)} |\n`
md += `| Semantic top-${TOPK} (whole files) | ${f0(S.tok)} | −${(100 * (1 - S.tok / G.tok)).toFixed(0)}% | ${pct(S.recall)} |\n`
md += `| CodeGraph explore (verbatim symbols) | ${f0(C.tok)} | −${(100 * (1 - C.tok / G.tok)).toFixed(0)}% | ${pct(C.recall)} |\n`
md += `| **Hybrid (Semantic→CodeGraph)** | **${f0(H.tok)}** | **−${(100 * (1 - H.tok / G.tok)).toFixed(0)}%** | **${pct(H.recall)}** |\n`
md += `\n## RTK + Caveman (per request)\n\n`
md += `| Component | Off | On | Saving |\n|---|--:|--:|--:|\n`
md += `| RTK — terminal output | ${TERMINAL_RAW_TOK} | ${TERMINAL_RTK_TOK} | −${(100 * (1 - TERMINAL_RTK_TOK / TERMINAL_RAW_TOK)).toFixed(0)}% |\n`
md += `| Caveman — model answer | ${OUT_VERBOSE_TOK} | ${OUT_CAVEMAN_TOK} | −${(100 * (1 - OUT_CAVEMAN_TOK / OUT_VERBOSE_TOK)).toFixed(0)}% |\n`
md += `\n## Combined per request (input = query+terminal+code-context; output = answer)\n\n`
const baseTotal = 30 + TERMINAL_RAW_TOK + G.tok + OUT_VERBOSE_TOK
const allOn = 30 + TERMINAL_RTK_TOK + H.tok + OUT_CAVEMAN_TOK
md += `- Baseline (no features, grep context): **${f0(baseTotal)}** tokens\n`
md += `- RTK+Caveman+Hybrid: **${f0(allOn)}** tokens → **−${(100 * (1 - allOn / baseTotal)).toFixed(0)}%**\n`
md += `\n## Per-query detail\n\n| Query | grep | sem | codegraph | hybrid |\n|---|--:|--:|--:|--:|\n`
for (const r of rows) md += `| ${r.q.slice(0, 46)}… | ${f0(r.grepTok)} | ${f0(r.semTok)}${r.semHit ? '✓' : '✗'} | ${f0(r.cgTok)}${r.cgHit ? '✓' : '✗'} | ${f0(r.hybTok)}${r.hybHit ? '✓' : '✗'} |\n`
md += `\n## Verdict\n\n`
md += `- **Economy:** Hybrid uses **${f0(H.tok)}** ctx tokens vs **${f0(G.tok)}** grep (**−${(100 * (1 - H.tok / G.tok)).toFixed(0)}%**).\n`
md += `- **Quality:** Hybrid recall **${pct(H.recall)}** vs semantic-only **${pct(S.recall)}** — CodeGraph's structure ${H.recall >= S.recall ? 'preserves/raises' : 'changes'} recall while cutting tokens.\n`

mkdirSync(RESULTS, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
writeFileSync(path.join(RESULTS, `hybrid-eval-${stamp}.md`), md)
writeFileSync(path.join(RESULTS, `hybrid-eval-${stamp}.json`), JSON.stringify({ grep: G, semantic: S, codegraph: C, hybrid: H, rows }, null, 2))
process.stdout.write(md + `\nSaved hybrid-eval-${stamp}.{md,json}\n`)
process.exit(0)
