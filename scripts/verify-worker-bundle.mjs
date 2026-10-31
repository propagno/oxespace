#!/usr/bin/env node
/**
 * The OxeQuery worker bundles CommonJS libraries (pg, mongodb, ssh2) into an ES
 * module. Whether that works is only knowable by loading the built file, so this
 * starts it and asks it to ping. Run after `electron-vite build`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

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
