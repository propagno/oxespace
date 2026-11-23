'use strict'
// OXE-400: the four arms behind one interface, as the main process sees them.
//   host = await openHost(arm)
//   term = await host.spawn({ file, args, cwd, env, cols, rows })
//   term.pid · term.onData(text => …) · term.onExit(code => …) · term.write(text) · term.resize(c, r) · term.kill()
//   host.pid (the process that owns the PTYs) · host.panic() · host.close()
// Every arm hands the main process text, as node-pty does today; C and D decode their bytes here with a streaming
// UTF-8 decoder, so the decoding cost is on the same side in every arm.
const { spawn: spawnChild } = require('node:child_process')
const { join } = require('node:path')
const { utilityProcess } = require('electron')
const frames = require('./frames.cjs')

function emitter() {
  const listeners = new Set()
  return { on: fn => { listeners.add(fn); return () => listeners.delete(fn) }, emit: value => { for (const fn of listeners) fn(value) } }
}

function terminal(pid, actions) {
  const data = emitter()
  const exit = emitter()
  let ended = false
  return {
    pid,
    ...actions,
    onData: data.on,
    onExit: exit.on,
    get ended() { return ended },
    _data: text => data.emit(text),
    _exit: code => { if (ended) return; ended = true; exit.emit(code) },
  }
}

function conptyOptions() {
  return process.platform === 'win32' ? { useConptyDll: true } : {}
}

async function openA() {
  const nodePty = require('node-pty')
  return {
    arm: 'A',
    pid: process.pid,
    async spawn({ file, args, cwd, env, cols, rows }) {
      const pty = nodePty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env, ...conptyOptions() })
      const term = terminal(pty.pid, { write: text => pty.write(text), resize: (c, r) => pty.resize(c, r), kill: () => pty.kill() })
      pty.onData(text => term._data(text))
      pty.onExit(({ exitCode }) => term._exit(exitCode))
      return term
    },
    panic: null,
    close() {},
  }
}

async function openUtility(arm) {
  const child = utilityProcess.fork(join(__dirname, 'utility.cjs'), [], {
    serviceName: `oxe-400-pty-host-${arm}`,
    stdio: 'inherit',
    env: { ...process.env, POC_ARM: arm },
  })
  const terms = new Map()
  const waiting = new Map()
  const decoders = new Map()
  let nextId = 1
  let hostPid = 0
  let alive = true
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`utility host ${arm} did not start`)), 15000)
    child.on('message', message => {
      if (message.t === 'ready') { hostPid = message.pid; clearTimeout(timer); resolve() }
    })
  })
  child.on('message', message => {
    if (message.t === 'spawned') { waiting.get(message.id)?.resolve(message.pid); waiting.delete(message.id) }
    else if (message.t === 'error' && waiting.has(message.id)) { waiting.get(message.id).reject(new Error(message.message)); waiting.delete(message.id) }
    else if (message.t === 'data') {
      const term = terms.get(message.id)
      if (!term) return
      if (typeof message.data === 'string') term._data(message.data)
      else term._data(decoders.get(message.id).decode(message.data, { stream: true }))
    } else if (message.t === 'exit') terms.get(message.id)?._exit(message.code)
  })
  // The host is gone (crash, kill): every terminal it held has ended; the main process carries on.
  child.on('exit', code => {
    alive = false
    for (const term of terms.values()) term._exit(`host-exit:${code}`)
    for (const pending of waiting.values()) pending.reject(new Error(`host exited ${code}`))
  })
  await ready
  return {
    arm,
    get pid() { return hostPid },
    get alive() { return alive },
    async spawn(options) {
      const id = nextId++
      decoders.set(id, new TextDecoder('utf-8'))
      const pid = await new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        child.postMessage({ t: 'spawn', id, ...options })
      })
      const term = terminal(pid, {
        write: text => child.postMessage({ t: 'write', id, data: text }),
        resize: (cols, rows) => child.postMessage({ t: 'resize', id, cols, rows }),
        kill: () => child.postMessage({ t: 'kill', id }),
      })
      terms.set(id, term)
      return term
    },
    panic() { child.postMessage({ t: 'host-panic' }) },
    close() { if (alive) child.kill() },
  }
}

async function openD() {
  const child = spawnChild(process.env.POC_BIN_HOST, [], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true, env: process.env })
  const terms = new Map()
  const waiting = new Map()
  const decoders = new Map()
  let nextId = 1
  let alive = true
  child.stdout.on('data', frames.decoder((kind, id, payload) => {
    if (kind === frames.KIND.SPAWNED) { waiting.get(id)?.resolve(payload.readUInt32LE(0)); waiting.delete(id) }
    else if (kind === frames.KIND.ERROR && waiting.has(id)) { waiting.get(id).reject(new Error(payload.toString('utf8'))); waiting.delete(id) }
    else if (kind === frames.KIND.DATA) terms.get(id)?._data(decoders.get(id).decode(payload, { stream: true }))
    else if (kind === frames.KIND.EXIT) terms.get(id)?._exit(Number(payload.readBigInt64LE(0)))
  }))
  child.stdin.on('error', () => {})
  child.on('exit', (code, signal) => {
    alive = false
    for (const term of terms.values()) term._exit(`host-exit:${code ?? signal}`)
    for (const pending of waiting.values()) pending.reject(new Error(`host exited ${code ?? signal}`))
  })
  const send = (kind, id, payload) => { if (alive) child.stdin.write(frames.encode(kind, id, payload)) }
  return {
    arm: 'D',
    pid: child.pid,
    get alive() { return alive },
    async spawn(options) {
      const id = nextId++
      decoders.set(id, new TextDecoder('utf-8'))
      const pid = await new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject })
        send(frames.KIND.SPAWN, id, frames.spawnPayload(options))
      })
      const term = terminal(pid, {
        write: text => send(frames.KIND.WRITE, id, Buffer.from(text)),
        resize: (cols, rows) => { const size = Buffer.alloc(4); size.writeUInt16LE(cols, 0); size.writeUInt16LE(rows, 2); send(frames.KIND.RESIZE, id, size) },
        kill: () => send(frames.KIND.KILL, id),
      })
      terms.set(id, term)
      return term
    },
    panic() { send(frames.KIND.CRASH, 0) },
    close() { if (alive) { child.stdin.end(); setTimeout(() => { if (alive) child.kill() }, 1000).unref() } },
  }
}

async function openHost(arm) {
  if (arm === 'A') return openA()
  if (arm === 'B' || arm === 'C') return openUtility(arm)
  if (arm === 'D') return openD()
  throw new Error(`unknown arm ${arm}`)
}

module.exports = { openHost }
