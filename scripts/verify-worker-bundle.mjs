#!/usr/bin/env node
/**
 * The OxeQuery worker bundles CommonJS libraries (pg, mongodb, ssh2) into an ES
 * module. Whether that works is only knowable by loading the built file, so this
 * starts it and asks it to ping. Run after `electron-vite build`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

// Guardrail (OXE-492 / OXE-485): verify Vite compiled threadRender.worker.ts into a real renderer JS asset
// and never inlined raw TypeScript as `data:video/mp2t`.
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
console.log(`[worker] renderer threadRender worker compiled cleanly (${threadWorkerAssets.join(', ')}, 0 data:video/mp2t)`)

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
