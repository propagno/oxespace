// @vitest-environment node
import { expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'

test('shipped hook runs in the authorized checkout and disables detached automatic imports', async () => {
  const source = readFileSync(resolve('resources/memory/agent-hook.cjs'), 'utf8')
  const stdin = Object.assign(new EventEmitter(), { setEncoding: vi.fn() })
  const cwd = resolve('synthetic-authorized-checkout')
  const spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stdin: Object.assign(new EventEmitter(), { end: vi.fn() }), kill: vi.fn()
    })
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{}')); child.emit('close', 0) })
    return child
  })
  const output = new Promise<string>(resolveOutput => {
    const http = { request: (_options: unknown, callback: (response: EventEmitter) => void) => {
      const req = Object.assign(new EventEmitter(), {
        setTimeout: vi.fn(), destroy: vi.fn(), end: () => queueMicrotask(() => {
          const response = new EventEmitter()
          callback(response)
          response.emit('data', JSON.stringify({ result: { allowed: true, capture: true, context: true } }))
          response.emit('end')
        })
      })
      return req
    } }
    runInNewContext(source, {
      require: (name: string) => {
        if (name === 'node:fs') return { readFileSync: () => JSON.stringify({ executable: 'synthetic-memory', dataDir: 'data', configPath: 'config', url: 'http://127.0.0.1:1' }) }
        if (name === 'node:child_process') return { spawn }
        if (name === 'node:http') return http
        throw Error('Unexpected import')
      },
      process: { argv: ['node', 'hook', 'session-start', 'codex'], stdin,
        env: { OXESPACE_MEMORY_RUN: 'bound-run.json', AI_MEMORY_BACKFILL_ON_START: 'true', AI_MEMORY_AUTH_TOKEN: 'parent-secret' },
        stdout: { write: resolveOutput }, exit: vi.fn() },
      Buffer, setTimeout, clearTimeout
    })
    stdin.emit('data', JSON.stringify({ session_id: 'native-session', cwd }))
    stdin.emit('end')
  })
  expect(JSON.parse(await output)).toHaveProperty('hookSpecificOutput')
  expect(spawn).toHaveBeenCalledWith('synthetic-memory', expect.arrayContaining(['hook', '--capture-mode', 'allowlist']), expect.objectContaining({
    cwd, windowsHide: true, shell: false,
    env: { OXESPACE_MEMORY_RUN: 'bound-run.json', AI_MEMORY_BACKFILL_ON_START: 'false' }
  }))
})
