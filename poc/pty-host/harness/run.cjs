'use strict'
// OXE-400: runs every measured case, each in a fresh Electron process, with the arms interleaved round by round so
// the node-pty baseline (A) is measured on the same runner, in the same job, next to B, C and D. CI only
// (.github/workflows/pty-rust-poc.yml); never run on a developer machine.
// Env: POC_RESULTS (output dir) · POC_ARMS (default A,B,C,D) · POC_ROUNDS (5) · POC_QUIT_ROUNDS (30) · POC_SUITES
// Writes results.ndjson (one line per case) and summary.md (the tables of docs/validation/pty-rust-poc.md).
const { spawn } = require('node:child_process')
const { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const out = process.env.POC_RESULTS || join(process.cwd(), 'results', 'pty-rust-poc')
mkdirSync(out, { recursive: true })
const ndjson = join(out, 'results.ndjson')
const ARMS = (process.env.POC_ARMS || 'A,B,C,D').split(',')
const ROUNDS = Number(process.env.POC_ROUNDS || 5)
const QUIT_ROUNDS = Number(process.env.POC_QUIT_ROUNDS || 30)
const THROUGHPUT = (process.env.POC_THROUGHPUT || '1,4,16').split(',').map(Number)
const KINDS = (process.env.POC_KINDS || 'plain,ansi').split(',')
const QUIT_PATHS = (process.env.POC_QUIT_PATHS || 'menu,window,quit').split(',')
const SUITES = (process.env.POC_SUITES || 'throughput,echo,isolation,quit').split(',')
const CASE = join(__dirname, 'case.cjs')
const FAULTS = {
  A: ['listener-throws-on-exit', 'listener-throws-on-data'],
  B: ['listener-throws-on-exit', 'listener-throws-on-data', 'host-panic', 'host-killed'],
  C: ['listener-throws-on-exit', 'listener-throws-on-data', 'host-panic', 'host-killed'],
  D: ['listener-throws-on-exit', 'listener-throws-on-data', 'host-panic', 'host-killed'],
}

function env(extra) {
  const value = {}
  for (const [key, v] of Object.entries(process.env)) if (v !== undefined && !key.startsWith('OXESPACE_')) value[key] = v
  return { ...value, ...extra }
}

function runCase(suite, arm, params, round, timeoutMs = 240000) {
  return new Promise(resolve => {
    const started = Date.now()
    const args = [...(process.platform === 'linux' ? ['--no-sandbox'] : []), CASE]
    const child = spawn(require('electron'), args, {
      env: env({ POC_SUITE: suite, POC_ARM: arm, POC_PARAMS: JSON.stringify(params) }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); if (process.env.POC_DEBUG) process.stderr.write(chunk) })
    const timer = setTimeout(() => { child.kill('SIGKILL') }, timeoutMs)
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer)
      const line = stdout.split(/\r?\n/).reverse().find(text => text.startsWith('POC_RESULT '))
      let reported = null
      try { reported = line ? JSON.parse(line.slice('POC_RESULT '.length)) : null } catch {}
      const record = {
        os: process.platform, suite, arm, round, params, exitCode, signal, wallMs: Date.now() - started,
        reported, fallbackExit: stdout.includes('POC_FALLBACK_EXIT'), stderrTail: exitCode === 0 && !signal ? undefined : stderr.split(/\r?\n/).slice(-15).join('\n'),
      }
      appendFileSync(ndjson, `${JSON.stringify(record)}\n`)
      resolve(record)
    })
  })
}

/** A, B, C, D in round 1; B, C, D, A in round 2; …: no arm always runs first on a cold runner. */
function rotation(round) {
  const shift = (round - 1) % ARMS.length
  return [...ARMS.slice(shift), ...ARMS.slice(0, shift)]
}

async function main() {
  if (!existsSync(ndjson)) writeFileSync(ndjson, '')
  const log = record => {
    const r = record.reported
    const verdict = r?.error ? `error ${r.error.split('\n')[0]}` : `exit=${record.exitCode}${record.signal ? ` signal=${record.signal}` : ''}`
    console.log(`[poc] ${record.suite} ${record.arm} r${record.round} ${JSON.stringify(record.params)} ${verdict} ${record.wallMs} ms`)
  }
  if (SUITES.includes('throughput')) {
    for (let round = 1; round <= ROUNDS; round++)
      for (const arm of rotation(round))
        for (const terminals of THROUGHPUT)
          for (const kind of KINDS) log(await runCase('throughput', arm, { terminals, kind }, round, 180000))
  }
  if (SUITES.includes('echo')) {
    for (let round = 1; round <= ROUNDS; round++)
      for (const arm of rotation(round)) log(await runCase('echo', arm, {}, round))
  }
  if (SUITES.includes('isolation')) {
    for (let round = 1; round <= ROUNDS; round++)
      for (const arm of rotation(round))
        for (const fault of FAULTS[arm].filter(f => !process.env.POC_FAULTS || process.env.POC_FAULTS.split(',').includes(f))) log(await runCase('isolation', arm, { fault }, round, 60000))
  }
  if (SUITES.includes('quit')) {
    for (let round = 1; round <= QUIT_ROUNDS; round++)
      for (const arm of rotation(round))
        for (const path of QUIT_PATHS) log(await runCase('quit', arm, { path }, round, 60000))
  }
  writeFileSync(join(out, 'summary.md'), summarize(readFileSync(ndjson, 'utf8')))
  console.log(readFileSync(join(out, 'summary.md'), 'utf8'))
}

const median = values => quantile(values, 0.5)
function quantile(values, q) {
  const list = values.filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b)
  if (list.length === 0) return null
  return list[Math.min(list.length - 1, Math.floor(q * list.length))]
}
const fmt = (value, digits = 1) => (value === null || value === undefined ? '—' : Number(value).toFixed(digits))
const clean = record => record.exitCode === 0 && !record.signal

function summarize(text) {
  const records = text.split('\n').filter(Boolean).map(line => JSON.parse(line))
  const os = records[0]?.os ?? process.platform
  const lines = [`## ${os}`, '']
  const by = (suite, arm) => records.filter(record => record.suite === suite && record.arm === arm)

  const tp = records.filter(record => record.suite === 'throughput')
  if (tp.length) {
    lines.push('### CA-3 Vazão, CPU e memória (50 MB no total, divididos entre os terminais; mediana / pior de 5 rodadas)', '')
    lines.push('| Braço | Terminais | Saída | MB/s | CPU principal % | Memória por terminal MB | Rodadas completas |', '| --- | --- | --- | --- | --- | --- | --- |')
    for (const arm of ARMS) for (const terminals of [1, 4, 16]) for (const kind of ['plain', 'ansi']) {
      const rows = tp.filter(r => r.arm === arm && r.params.terminals === terminals && r.params.kind === kind)
      if (rows.length === 0) continue
      const ok = rows.filter(r => r.reported?.complete)
      const values = key => ok.map(r => r.reported[key])
      const worstLow = list => (list.length ? Math.min(...list) : null)
      const worstHigh = list => (list.length ? Math.max(...list) : null)
      lines.push(`| ${arm} | ${terminals} | ${kind} | ${fmt(median(values('mbPerSecond')))} / ${fmt(worstLow(values('mbPerSecond')))} | ${fmt(median(values('mainCpuPercent')))} / ${fmt(worstHigh(values('mainCpuPercent')))} | ${fmt(median(values('memoryPerTerminalMb')))} / ${fmt(worstHigh(values('memoryPerTerminalMb')))} | ${ok.length}/${rows.length} |`)
    }
    lines.push('')
  }

  const echo = records.filter(record => record.suite === 'echo')
  if (echo.length) {
    lines.push('### CA-2 Eco de tecla (ms; 1 terminal parado, 8 imprimindo 1 MB/s cada; 20 amostras × 5 rodadas)', '')
    lines.push('| Braço | Parado p50 | Sob carga p50 | p95 | p99 | Pior p95 de rodada | Laço principal p95 (mediana) | Sem eco | ConPTY |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const arm of ARMS) {
      const rows = by('echo', arm).filter(r => r.reported && !r.reported.error)
      if (rows.length === 0) continue
      const load = rows.flatMap(r => r.reported.loadMs)
      const idle = rows.flatMap(r => r.reported.idleMs)
      const consoles = [...new Set(rows.flatMap(r => r.reported.consoles ?? []))].join(', ') || '—'
      lines.push(`| ${arm} | ${fmt(median(idle))} | ${fmt(median(load))} | ${fmt(quantile(load, 0.95))} | ${fmt(quantile(load, 0.99))} | ${fmt(rows.length ? Math.max(...rows.map(r => r.reported.loadP95 ?? 0)) : null)} | ${fmt(median(rows.map(r => r.reported.mainLoopP95Ms)))} | ${rows.reduce((n, r) => n + r.reported.timeouts, 0)} | ${consoles} |`)
    }
    lines.push('')
  }

  const iso = records.filter(record => record.suite === 'isolation')
  if (iso.length) {
    lines.push('### CA-1 Isolamento (rodadas em que o processo principal sobreviveu e o terminal foi dado como encerrado)', '')
    lines.push('| Braço | Falha | Principal vivo | Terminal encerrado | Terminal segue funcionando | Saídas do processo quando abortou |', '| --- | --- | --- | --- | --- | --- |')
    for (const arm of ARMS) for (const fault of FAULTS[arm]) {
      const rows = iso.filter(r => r.arm === arm && r.params.fault === fault)
      if (rows.length === 0) continue
      const alive = rows.filter(r => r.reported?.survived && clean(r))
      const ended = alive.filter(r => r.reported.ended)
      const works = alive.filter(r => r.reported.stillWorks === true)
      const deaths = [...new Set(rows.filter(r => !clean(r)).map(r => (r.reported?.survived ? `ao sair depois: ${r.signal ?? r.exitCode}` : `${r.signal ?? r.exitCode}`)))].join(', ') || '—'
      const endedCell = fault === 'listener-throws-on-data' ? 'não se aplica' : `${ended.length}/${rows.length}`
      const worksCell = fault === 'listener-throws-on-data' ? `${works.length}/${rows.length}` : 'não se aplica'
      lines.push(`| ${arm} | ${fault} | ${alive.length}/${rows.length} | ${endedCell} | ${worksCell} | ${deaths} |`)
    }
    lines.push('')
  }

  const quit = records.filter(record => record.suite === 'quit')
  if (quit.length) {
    lines.push('### CA-4 Saída com 4 shells vivos (saídas limpas, código 0 e sem sinal)', '')
    lines.push('| Braço | Menu Sair | Fechar a janela | app.quit() | Saídas não limpas | Saídas só pelo limite de 5 s | Tempo até sair, mediana / pior (ms) |', '| --- | --- | --- | --- | --- | --- | --- |')
    for (const arm of ARMS) {
      const cell = path => { const rows = quit.filter(r => r.arm === arm && r.params.path === path); return `${rows.filter(clean).length}/${rows.length}` }
      const bad = [...new Set(quit.filter(r => r.arm === arm && !clean(r)).map(r => `${r.params.path}:${r.signal ?? r.exitCode}`))].join(', ') || '—'
      const rows = quit.filter(r => r.arm === arm)
      if (rows.length === 0) continue
      const walls = rows.map(r => r.wallMs)
      lines.push(`| ${arm} | ${cell('menu')} | ${cell('window')} | ${cell('quit')} | ${bad} | ${rows.filter(r => r.fallbackExit).length}/${rows.length} | ${fmt(median(walls), 0)} / ${fmt(walls.length ? Math.max(...walls) : null, 0)} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

if (require.main === module) {
  if (process.argv[2] === '--summary') console.log(summarize(readFileSync(process.argv[3], 'utf8')))
  else main().catch(error => { console.error(error); process.exit(1) })
}

module.exports = { summarize }
