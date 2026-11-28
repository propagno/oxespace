#!/usr/bin/env node
/**
 * The OxeQuery worker bundles CommonJS libraries (pg, mongodb, ssh2) into an ES
 * module. Whether that works is only knowable by loading the built file, so this
 * starts it and asks it to ping. Run after `electron-vite build`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { Worker } from 'node:worker_threads'

// Guardrail (OXE-492 / OXE-493 / OXE-485): verify Vite compiled threadRender.worker.ts into a real renderer JS asset,
// never inlined raw TypeScript as `data:video/mp2t`, and executes cleanly without `document` (Web Worker environment).
const rendererAssetsDir = join(process.cwd(), 'out', 'renderer', 'assets')
if (!existsSync(rendererAssetsDir)) {
  console.error(`[worker] ${rendererAssetsDir} does not exist. Build first.`)
  process.exit(1)
}
const assetFiles = readdirSync(rendererAssetsDir)
const threadWorkerAssets = assetFiles.filter(name => /^threadRender\.worker-.*\.js$/.test(name))
if (threadWorkerAssets.length === 0) {
  console.error(`[worker] compiled threadRender.worker-*.js asset missing from ${rendererAssetsDir}`)
  process.exit(1)
}
for (const file of assetFiles) {
  if (!file.endsWith('.js')) continue
  const content = readFileSync(join(rendererAssetsDir, file), 'utf8')
  if (content.includes('data:video/mp2t')) {
    console.error(`[worker] found raw TypeScript data:video/mp2t inline worker in ${file}`)
    process.exit(1)
  }
}

for (const workerAsset of threadWorkerAssets) {
  const workerPath = join(rendererAssetsDir, workerAsset)
  const workerSource = readFileSync(workerPath, 'utf8')
  const replies = []
  const sandbox = {
    document: undefined,
    window: undefined,
    console,
    URL,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    structuredClone,
    performance,
    navigator: { userAgent: 'verify-worker-bundle' },
    onmessage: null,
    postMessage: message => replies.push(message)
  }
  sandbox.self = sandbox
  sandbox.globalThis = sandbox

  try {
    vm.runInNewContext(workerSource, sandbox, { filename: workerPath, timeout: 10_000 })
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(`[worker] ${workerAsset} threw on startup without document: ${message}`)
    process.exit(1)
  }

  if (typeof sandbox.onmessage !== 'function') {
    console.error(`[worker] ${workerAsset} did not register self.onmessage`)
    process.exit(1)
  }

  const sampleMarkdown = '# Hello &amp; **world**\n\n```ts\nconst x = 1\n```\n\nInline $a + b$'
  try {
    sandbox.onmessage({ data: { id: 1, text: sampleMarkdown } })
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(`[worker] ${workerAsset} threw while handling message without document: ${message}`)
    process.exit(1)
  }

  const reply = replies.find(item => item && item.id === 1)
  if (!reply || reply.tree?.type !== 'root' || !Array.isArray(reply.tree.children) || reply.tree.children.length < 2) {
    console.error(`[worker] ${workerAsset} returned invalid reply: ${JSON.stringify(replies)}`)
    process.exit(1)
  }
  const serialized = JSON.stringify(reply.tree)
  if (!serialized.includes('Hello & ') || !serialized.includes('"tagName":"strong"') || !serialized.includes('"threadLanguageName":"TypeScript"') || !serialized.includes('katex')) {
    console.error(`[worker] ${workerAsset} rendered incomplete tree: ${serialized.slice(0, 300)}`)
    process.exit(1)
  }
}
console.log(`[worker] renderer threadRender worker boots and renders without document (${threadWorkerAssets.join(', ')}, 0 data:video/mp2t)`)

const path = join(process.cwd(), 'out', 'main', 'oxequery-worker.js')
if (!existsSync(path)) {
  console.error(`[worker] ${path} does not exist. Build first.`)
  process.exit(1)
}

const worker = new Worker(pathToFileURL(path))
const timer = setTimeout(() => fail('the worker did not answer within 10 s'), 10_000)

function fail(message) {
  clearTimeout(timer)
  console.error(`[worker] ${message}`)
  void worker.terminate().finally(() => process.exit(1))
}

worker.once('error', error => fail(`failed to load: ${error.message.split('\n')[0]}`))
worker.once('message', message => {
  clearTimeout(timer)
  const drivers = message?.result?.drivers
  if (!drivers?.postgres || !drivers?.mongodb || !drivers?.ssh) return fail(`a driver is missing: ${JSON.stringify(message)}`)
  console.log('[worker] OxeQuery worker loads and has the postgres, mongodb and ssh drivers')
  void worker.terminate().finally(() => process.exit(0))
})
worker.postMessage({ requestId: 1, op: 'ping' })
