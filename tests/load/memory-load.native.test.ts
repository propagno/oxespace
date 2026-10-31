// @vitest-environment node
/**
 * Synthetic load and soak for the durable memory producer (V14).
 *
 * Real AI Memory 2.6.2 server, the real outbox, delivery worker and client. The server is killed
 * periodically and restarted on the same port and data directory. Opt-in because it is long:
 *
 *   OXESPACE_MEMORY_LOAD=1 OXESPACE_AI_MEMORY_V26_TEST_BINARY=<ai-memory 2.6.2> \
 *   OXESPACE_LOAD_MINUTES=120 OXESPACE_LOAD_REPORT=<new json file> \
 *   node scripts/test-electron.mjs tests/load/memory-load.native.test.ts --maxWorkers=1
 *
 * Knobs (defaults are a ~2 minute smoke): OXESPACE_LOAD_MINUTES, OXESPACE_LOAD_SESSIONS (4),
 * OXESPACE_LOAD_OUTAGE_EVERY_S (40), OXESPACE_LOAD_OUTAGE_S (10), OXESPACE_LOAD_BURST (20 events per
 * session every 60 s), OXESPACE_LOAD_REOPEN_EVERY_S (0 = never; reopen outbox and worker like an app restart).
 * The report holds counts and timings only, never event text.
 */
import { afterAll, expect, test } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { AiMemoryClient } from '../../electron/main/services/memory/ai-memory.client'
import { MemoryOutbox } from '../../electron/main/services/memory/memory-outbox'
import { MemoryDeliveryWorker } from '../../electron/main/services/memory/memory-delivery'
import { measureMemoryStorage } from '../../electron/main/services/memory/memory-storage'

const binary = process.env.OXESPACE_AI_MEMORY_V26_TEST_BINARY
const enabled = process.env.OXESPACE_MEMORY_LOAD === '1'
const number = (name: string, fallback: number): number => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value >= 0 ? value : fallback
}
const MINUTES = number('OXESPACE_LOAD_MINUTES', 2)
const SESSIONS = Math.max(1, Math.floor(number('OXESPACE_LOAD_SESSIONS', 4)))
const OUTAGE_EVERY_MS = number('OXESPACE_LOAD_OUTAGE_EVERY_S', 40) * 1000
const OUTAGE_MS = number('OXESPACE_LOAD_OUTAGE_S', 10) * 1000
const BURST = Math.floor(number('OXESPACE_LOAD_BURST', 20))
const REOPEN_EVERY_MS = number('OXESPACE_LOAD_REOPEN_EVERY_S', 0) * 1000
const REPORT = process.env.OXESPACE_LOAD_REPORT
const scope = { workspace: 'load', project: 'synthetic' }
const sleep = (ms: number): Promise<void> => new Promise(resolveDelay => setTimeout(resolveDelay, ms))
const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
}

let directory: string | undefined
let server: ChildProcess | undefined
afterAll(async () => {
  if (server?.pid && server.exitCode === null) server.kill('SIGKILL')
  if (directory) {
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('oxe-memory-load-')) throw Error('Unsafe fixture cleanup')
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

test.skipIf(!enabled || !binary)(`memory load: ${MINUTES} min, ${SESSIONS} sessions, server outages`, async () => {
  directory = await mkdtemp(join(tmpdir(), 'oxe-memory-load-'))
  if (REPORT && existsSync(REPORT)) throw Error('Refusing to overwrite an existing report')
  const cwd = join(directory, 'project')
  const dataDir = join(directory, 'data')
  await mkdir(cwd)
  await mkdir(dataDir)
  await writeFile(join(cwd, '.ai-memory.toml'), `workspace = "${scope.workspace}"\nproject = "${scope.project}"\n`)
  const port = await new Promise<number>((resolvePort, reject) => {
    const socket = createServer()
    socket.on('error', reject)
    socket.listen(0, '127.0.0.1', () => { const address = socket.address() as { port: number }; socket.close(() => resolvePort(address.port)) })
  })
  const url = `http://127.0.0.1:${port}`
  const token = randomUUID()
  const config = join(directory, 'config.toml')
  await writeFile(config, `embedding_provider = "none"\nserver_url = "${url}"\ncapture_assistant = true\n[profile]\nenabled = false\n[handoff]\nclaim_on_session_start = false\n[auto_improve.scheduler]\nenabled = false\n`)
  await writeFile(join(dataDir, 'auth-token'), token)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('AI_MEMORY_')))
  const client = new AiMemoryClient(url, token)

  const start = async (): Promise<void> => {
    server = spawn(binary!, ['--data-dir', dataDir, '--config', config, 'serve', '--transport', 'http', '--bind', new URL(url).host, '--enable-api'],
      { env: { ...env, AI_MEMORY_AUTH_TOKEN: token }, windowsHide: true, stdio: 'ignore' })
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) throw Error('Load server exited before readiness')
      try { await client.initialize(); return } catch { await sleep(100) }
    }
    throw Error('Load server did not initialize')
  }
  const stop = async (): Promise<void> => {
    const child = server
    if (!child || child.exitCode !== null) return
    await new Promise<void>(resolveExit => { child.once('exit', () => resolveExit()); child.kill('SIGKILL') })
  }
  await start()

  const run = randomUUID().slice(0, 8)
  const outboxDirectory = join(directory, 'outbox')
  let outbox = new MemoryOutbox(outboxDirectory)
  await outbox.init()
  let worker = new MemoryDeliveryWorker(outbox, () => client)
  const sessions = Array.from({ length: SESSIONS }, (_, index) => ({ id: randomUUID(), agent: index % 2 ? 'claude-code' : 'codex', started: false, seq: 0 }))
  const admitted = new Set<string>()
  const admitLatencies: number[] = []
  const expectedTags: string[] = []
  let refused = 0
  let maxPending = 0
  let maxBytes = 0
  let outages = 0
  const drains: number[] = []
  const reopenCounts = { count: 0 }

  async function emit(session: (typeof sessions)[number], event: 'session-start' | 'user-prompt-submit' | 'stop'): Promise<void> {
    session.seq++
    const tag = `LOAD${run}-${session.id.slice(0, 8)}-${session.seq}`
    const key = MemoryOutbox.ingestKey([scope.project, session.agent, session.id, event, tag])
    const query = new URLSearchParams({ ...scope, agent: session.agent === 'codex' ? 'codex' : 'claude-code', event, extension: 'oxespace.load', source_event: event, ingest_key: key })
    if (event === 'stop') query.set('capture_assistant', '1')
    const prompt = `${tag} ${'x'.repeat(900)}`
    const body = event === 'stop' ? { session_id: session.id, cwd, _ai_memory_assistant: { version: 1, excerpt: `${tag} done` } }
      : { session_id: session.id, cwd, prompt }
    const began = performance.now()
    const ok = await outbox.admit({ key, projectId: scope.project, sessionId: session.id, createdAt: Date.now(), policy: 'keep', item: { url: `/hook?${query}`, body } })
    admitLatencies.push(performance.now() - began)
    if (!ok) { refused++; return }
    admitted.add(key)
    if (event !== 'session-start') expectedTags.push(tag)
    worker.wake()
  }

  const deadline = Date.now() + MINUTES * 60_000
  let nextOutage = Date.now() + OUTAGE_EVERY_MS
  let nextBurst = Date.now() + 60_000
  let nextReopen = REOPEN_EVERY_MS ? Date.now() + REOPEN_EVERY_MS : Infinity
  const rssSamples: { atMinute: number; rssMiB: number; handles: number }[] = []
  let nextSample = Date.now()
  const began = Date.now()
  let tick = 0
  while (Date.now() < deadline) {
    const tickStart = Date.now()
    for (const session of sessions) {
      if (!session.started) { await emit(session, 'session-start'); session.started = true }
      await emit(session, tick % 20 === 19 ? 'stop' : 'user-prompt-submit')
    }
    if (BURST && tickStart >= nextBurst) { nextBurst = tickStart + 60_000; await Promise.all(sessions.map(async session => { for (let i = 0; i < BURST; i++) await emit(session, 'user-prompt-submit') })) }
    const stats = outbox.stats()
    maxPending = Math.max(maxPending, stats.pending)
    maxBytes = Math.max(maxBytes, stats.bytes)
    if (tickStart >= nextSample) {
      nextSample = tickStart + 10 * 60_000
      rssSamples.push({ atMinute: Math.round((tickStart - began) / 60_000), rssMiB: Math.round(process.memoryUsage().rss / 1048576), handles: process.getActiveResourcesInfo().length })
    }
    if (OUTAGE_MS && tickStart >= nextOutage) {
      outages++
      await stop()
      const downUntil = Date.now() + OUTAGE_MS
      while (Date.now() < downUntil) {
        for (const session of sessions) await emit(session, 'user-prompt-submit')
        maxPending = Math.max(maxPending, outbox.stats().pending)
        await sleep(1000)
      }
      await start()
      const back = Date.now()
      nextOutage = back + OUTAGE_EVERY_MS
      void (async () => {
        const limit = back + 180_000
        while (Date.now() < limit && outbox.stats().pending > 50) await sleep(500)
        drains.push(Date.now() - back)
      })()
    }
    if (Date.now() >= nextReopen) {
      nextReopen = Date.now() + REOPEN_EVERY_MS
      await worker.stop()
      outbox = new MemoryOutbox(outboxDirectory)
      await outbox.init()
      worker = new MemoryDeliveryWorker(outbox, () => client)
      worker.wake()
      reopenCounts.count++
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tickStart)))
    tick++
  }

  // Final drain: everything admitted must reach the server.
  const drainDeadline = Date.now() + 300_000
  while (Date.now() < drainDeadline && outbox.stats().pending > 0) { worker.wake(); await worker.flush(); await sleep(500) }
  const finalPending = outbox.stats().pending
  await worker.stop()

  const database = new Database(join(dataDir, 'db', 'memory.sqlite'), { readonly: true })
  const counts = new Map<string, number>()
  try {
    for (const row of database.prepare("SELECT body FROM observations WHERE body LIKE ?").iterate(`%LOAD${run}-%`) as Iterable<{ body: string }>) {
      const found = new RegExp(`LOAD${run}-[0-9a-f]{8}-\\d+`).exec(row.body)
      if (found) counts.set(found[0], (counts.get(found[0]) ?? 0) + 1)
    }
  } finally { database.close() }
  const missing = expectedTags.filter(tag => !counts.has(tag)).length
  const duplicated = [...counts.values()].filter(count => count > 1).length
  const storage = await measureMemoryStorage(directory)
  const lastRss = rssSamples.at(-1)
  const report = {
    kind: 'memory-load', version: '2.6.2', platform: process.platform, minutes: MINUTES, sessions: SESSIONS, outages, reopens: reopenCounts.count,
    admitted: admitted.size, expectedObservations: expectedTags.length, storedObservations: counts.size, missing, duplicated, refused, finalPending,
    maxPending, maxOutboxMiB: Math.round(maxBytes / 1048576 * 10) / 10,
    admitMs: { p50: percentile(admitLatencies, 0.5), p95: percentile(admitLatencies, 0.95), p99: percentile(admitLatencies, 0.99) },
    drainAfterOutageMs: drains, rssSamples, rssGrowthMiB: rssSamples.length > 1 && lastRss ? lastRss.rssMiB - rssSamples[0].rssMiB : 0,
    memoryDirMiB: Math.round(storage.totalBytes / 1048576), delivery: worker.stats()
  }
  if (REPORT) await writeFile(REPORT, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log('MEMORY_LOAD_REPORT', JSON.stringify(report))

  expect(missing).toBe(0)
  expect(duplicated).toBe(0)
  expect(refused).toBe(0)
  expect(finalPending).toBe(0)
  expect(maxPending).toBeLessThanOrEqual(10_000)
  expect(maxBytes).toBeLessThanOrEqual(64 * 1024 * 1024)
  expect(report.admitMs.p95).toBeLessThan(50)
  for (const drain of drains) expect(drain).toBeLessThanOrEqual(120_000)
}, (MINUTES + 15) * 60_000)
