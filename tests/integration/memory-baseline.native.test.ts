// @vitest-environment node
import { expect, test } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, basename, join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { AiMemoryClient } from '../../electron/main/services/memory/ai-memory.client'
import { AiMemoryProvider } from '../../electron/main/services/memory/ai-memory.provider'

const binary = process.env.OXESPACE_MEMORY_BASELINE_BINARY
const report = process.env.OXESPACE_MEMORY_BASELINE_REPORT
const digest = process.env.OXESPACE_MEMORY_BASELINE_SHA256
if (report && (!binary || !digest)) throw Error('Baseline requires an explicit verified binary and SHA256; refusing skipped measurement')

test.skipIf(!binary)('measures synthetic provider retrieval baseline without model inference', async () => {
  if (!report || !digest) throw Error('Baseline output and binary checksum are required')
  const executableHash = createHash('sha256').update(await readFile(binary!)).digest('hex')
  expect(executableHash).toBe(digest.toLowerCase())
  const version = (await promisify(execFile)(binary!, ['--version'], { timeout: 5000, windowsHide: true })).stdout.trim()
  expect(version).toBe('ai-memory 2.1.0')
  const corpusBytes = await readFile(join(process.cwd(), 'tests/fixtures/memory-productivity.json'))
  const corpus = JSON.parse(corpusBytes.toString()) as { cases: { id: string; scenario: number; query: string; body: string; expected: string | null; foreign?: boolean }[] }
  expect(corpus.cases).toHaveLength(12)
  const directory = await mkdtemp(join(tmpdir(), 'oxe-memory-baseline-'))
  const target = resolve(directory)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('oxe-memory-baseline-')) throw Error('Invalid baseline cleanup target')
  let server: ChildProcess | undefined
  const context = { projectId: 'baseline', workspace: 'benchmark', project: 'baseline', cwd: join(directory, 'project') }
  const records: { id: string; repetition: number; queryMs: number; contextMs: number; firstRelevantRank: number | null; contextHit: boolean | null; contextChars: number; isolationPass: boolean | null }[] = []
  try {
    await mkdir(context.cwd)
    const dataDir = join(directory, 'data')
    await mkdir(dataDir)
    const port = await new Promise<number>((resolvePort, reject) => {
      const listener = createServer()
      listener.on('error', reject)
      listener.listen(0, '127.0.0.1', () => {
        const port = (listener.address() as { port: number }).port
        listener.close(() => resolvePort(port))
      })
    })
    const url = `http://127.0.0.1:${port}`
    const token = randomUUID()
    const config = join(directory, 'config.toml')
    await writeFile(config, `embedding_provider = "none"\nserver_url = "${url}"\n[auto_improve.scheduler]\nenabled = false\n`)
    await writeFile(join(dataDir, 'auth-token'), token)
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('AI_MEMORY_')))
    server = spawn(binary!, ['--data-dir', dataDir, '--config', config, 'serve', '--transport', 'http', '--bind', `127.0.0.1:${port}`, '--enable-web'], {
      env: { ...env, AI_MEMORY_AUTH_TOKEN: token, AI_MEMORY_BACKFILL_ON_START: 'false' }, windowsHide: true, stdio: 'ignore'
    })
    let launchError: Error | undefined
    server.on('error', error => { launchError = error })
    const client = new AiMemoryClient(url, token)
    const provider = new AiMemoryProvider(client)
    let ready = false
    for (let attempt = 0; attempt < 40; attempt++) {
      if (launchError) throw launchError
      if (server.exitCode !== null) throw Error('Baseline fixture exited before readiness')
      try { await provider.start(); ready = true; break } catch { /* bounded startup */ }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
    }
    if (!ready) throw Error('Baseline fixture did not initialize')
    for (const item of corpus.cases) {
      await provider.remember({ ...context, project: item.foreign ? 'other-project' : context.project }, { text: item.body, title: item.id })
    }
    // Alternate query order across repetitions to expose first-read/cache effects.
    for (let repetition = 1; repetition <= 3; repetition++) {
      const cases = repetition % 2 ? corpus.cases : [...corpus.cases].reverse()
      for (const item of cases) {
        let start = performance.now()
        const hits = await provider.search(context, item.query)
        const queryMs = performance.now() - start
        start = performance.now()
        const brief = await provider.getRelevantContext(context, item.query)
        const contextMs = performance.now() - start
        const rank = item.expected ? hits.findIndex(hit => hit.text.includes(item.expected!)) : -1
        const isolationPass = item.foreign ? !JSON.stringify(hits).includes('foreignprojectcanary') && !brief.text.includes('foreignprojectcanary') : null
        expect(brief.text.length).toBeLessThanOrEqual(4000)
        if (item.foreign) expect(isolationPass).toBe(true)
        records.push({ id: item.id, repetition, queryMs, contextMs, firstRelevantRank: rank < 0 ? null : rank + 1,
          contextHit: item.expected ? brief.text.includes(item.expected) : null, contextChars: brief.text.length, isolationPass })
      }
    }
    const percentile = (values: number[], quantile: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * quantile) - 1]
    const positives = records.filter(row => row.contextHit !== null)
    const output = { schemaVersion: 1, measurement: 'synthetic-provider-retrieval-only', at: new Date().toISOString(),
      version, executableHash, corpusSha256: createHash('sha256').update(corpusBytes).digest('hex'),
      platform: process.platform, arch: process.arch, node: process.version, electron: process.versions.electron,
      model: null, inferenceCalls: 0, samples: records.length,
      queryMedianMs: percentile(records.map(row => row.queryMs), .5), queryP95Ms: percentile(records.map(row => row.queryMs), .95),
      contextMedianMs: percentile(records.map(row => row.contextMs), .5), contextP95Ms: percentile(records.map(row => row.contextMs), .95),
      top5Relevant: positives.filter(row => row.firstRelevantRank !== null && row.firstRelevantRank <= 5).length,
      positiveSamples: positives.length, isolationPassed: records.filter(row => row.isolationPass === true).length,
      limitations: ['No UI or agent reasoning', 'No paired upgraded run', 'No human re-explanation or time-to-correct-action measurement'], records }
    await writeFile(resolve(report), JSON.stringify(output, null, 2) + '\n', { flag: 'wx' })
    console.info(JSON.stringify({ samples: output.samples, top5Relevant: output.top5Relevant, positiveSamples: output.positiveSamples,
      queryMedianMs: output.queryMedianMs, contextMedianMs: output.contextMedianMs, isolationPassed: output.isolationPassed }))
  } finally {
    if (server?.pid && server.exitCode === null) {
      const child = server
      await new Promise<void>((resolveExit, reject) => {
        const timer = setTimeout(() => reject(Error('Baseline child failed to stop')), 5000)
        child.once('exit', () => { clearTimeout(timer); resolveExit() })
        child.kill('SIGKILL')
      })
    }
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 90000)
