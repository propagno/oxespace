'use strict'
// OXE-400 arms B and C: the PTY host in an Electron utility process, talking to the main process over its parentPort.
//   B: node-pty 1.1.0, as the app uses it in the main process today (strings, useConptyDll on Windows)
//   C: the Rust host (rust/napi-host) as a Node-API module (bytes)
const arm = process.env.POC_ARM
const port = process.parentPort
const sessions = new Map()
let throwOnNativeExit = false

const rust = arm === 'C' ? require(process.env.POC_NAPI_MODULE) : null
const nodePty = arm === 'B' ? require('node-pty') : null

function send(message) {
  port.postMessage(message)
}

function spawn(message) {
  const { id, file, args, cwd, env, cols, rows } = message
  if (arm === 'B') {
    const pty = nodePty.spawn(file, args, {
      name: 'xterm-256color', cols, rows, cwd, env,
      ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
    })
    pty.onData(data => send({ t: 'data', id, data }))
    pty.onExit(({ exitCode }) => {
      // host-panic for B: an exception inside node-pty's native exit callback, the OXE-392 path, in the host.
      if (throwOnNativeExit) throw new Error('OXE-400: injected exception in the host exit callback')
      send({ t: 'exit', id, code: exitCode })
    })
    sessions.set(id, { write: data => pty.write(data), resize: (c, r) => pty.resize(c, r), kill: () => pty.kill(), pid: pty.pid })
    send({ t: 'spawned', id, pid: pty.pid })
    return
  }
  const envPairs = Object.entries(env).map(([key, value]) => `${key}=${value}`)
  const pty = rust.spawn({ file, args, cwd, env: envPairs, cols, rows },
    bytes => send({ t: 'data', id, data: bytes }),
    code => send({ t: 'exit', id, code: Number(code) }))
  sessions.set(id, { write: data => pty.write(Buffer.from(data)), resize: (c, r) => pty.resize(c, r), kill: () => pty.kill(), pid: pty.pid })
  send({ t: 'spawned', id, pid: pty.pid })
}

port.on('message', ({ data: message }) => {
  try {
    if (message.t === 'spawn') spawn(message)
    else if (message.t === 'write') sessions.get(message.id)?.write(message.data)
    else if (message.t === 'resize') sessions.get(message.id)?.resize(message.cols, message.rows)
    else if (message.t === 'kill') sessions.get(message.id)?.kill()
    else if (message.t === 'host-panic') {
      if (arm === 'C') rust.crash()
      else {
        throwOnNativeExit = true
        for (const session of sessions.values()) session.kill()
      }
    }
  } catch (error) {
    send({ t: 'error', id: message.id, message: String(error?.message ?? error) })
  }
})

send({ t: 'ready', pid: process.pid })
