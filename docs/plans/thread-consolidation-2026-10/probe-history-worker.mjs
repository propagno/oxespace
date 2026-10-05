// Read-only probe. Run after building; arguments: provider native-id project-root output-json.
import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

const [provider, id, rootPath, output] = process.argv.slice(2)
if (!['codex', 'claude'].includes(provider) || !id || !rootPath || !output) throw Error('Expected provider, native ID, project root and output file')
const worker = new Worker(resolve('out/main/native-history-worker.js'), { resourceLimits: { maxOldGenerationSizeMb: 128 } })
let sequence = 0, cursor, pages = 0, messages = 0, duplicates = 0, emptyPages = 0
let firstPageMs, lastTick = performance.now(), maxTickGapMs = 0, peakRssBytes = 0
const ids = new Set()
const clock = setInterval(() => {
  const now = performance.now()
  maxTickGapMs = Math.max(maxTickGapMs, now - lastTick); lastTick = now
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
}, 10)
const started = performance.now()
try {
  do {
    if (++pages > 1000) throw Error('Probe page budget exceeded')
    const result = await new Promise((resolvePage, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(Error('Page timed out')) }, 30000)
      const cleanup = () => { clearTimeout(timer); worker.off('message', received); worker.off('error', failed); worker.off('exit', exited) }
      const received = message => { cleanup(); message.error ? reject(Error(message.error)) : resolvePage(message.result) }
      const failed = error => { cleanup(); reject(error) }
      const exited = code => failed(Error(`Worker exited: ${code}`))
      worker.once('message', received); worker.once('error', failed); worker.once('exit', exited)
      worker.postMessage({ requestId: ++sequence, executable: provider, thread: { provider, rootPath }, id, cursor })
    })
    if (pages === 1) firstPageMs = performance.now() - started
    if (!result.events.length) emptyPages++
    for (const event of result.events) if (event.type === 'message') {
      messages++
      if (ids.has(event.id)) duplicates++
      ids.add(event.id)
    }
    cursor = result.cursor
  } while (cursor)
  const report = { capturedAt: new Date().toISOString(), provider, source: 'local-native-file-via-production-worker', inference: false, installedApplication: false,
    firstPageMs, totalMs: performance.now() - started, pages, messages, duplicates, emptyPages, maxTickGapMs, peakRssBytes }
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally { clearInterval(clock); await worker.terminate() }
