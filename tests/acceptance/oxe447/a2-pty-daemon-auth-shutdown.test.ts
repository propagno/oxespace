import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IDisposable, IPty } from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import { DaemonPtyClient } from '../../../electron/main/services/terminal/daemon-pty'
import {
  PTY_DAEMON_PROTOCOL_VERSION,
  assertLocalDaemonEndpoint,
  generateDaemonToken
} from '../../../electron/main/services/terminal/pty-daemon-protocol'
import { createPtyDaemonServer } from '../../../electron/main/workers/pty-daemon'

interface TrackedFakePty {
  pty: IPty
  killed: boolean
  emitData: (chunk: string) => void
  emitExit: (code: number) => void
}

function makeFakePty(pid: number): TrackedFakePty {
  const dataListeners = new Set<(d: string) => void>()
  const exitListeners = new Set<(e: { exitCode: number; signal?: number }) => void>()
  const tracker: TrackedFakePty = {
    killed: false,
    emitData(chunk: string) {
      for (const fn of dataListeners) fn(chunk)
    },
    emitExit(code: number) {
      for (const fn of exitListeners) fn({ exitCode: code })
    },
    pty: {
      pid,
      cols: 80,
      rows: 24,
      process: 'fake-shell',
      handleFlowControl: false,
      onData(fn: (d: string) => void): IDisposable {
        dataListeners.add(fn)
        return { dispose: () => { dataListeners.delete(fn) } }
      },
      onExit(fn: (e: { exitCode: number; signal?: number }) => void): IDisposable {
        exitListeners.add(fn)
        return { dispose: () => { exitListeners.delete(fn) } }
      },
      write() { /* noop */ },
      resize() { /* noop */ },
      clear() { /* noop */ },
      kill() {
        tracker.killed = true
        tracker.emitExit(0)
      },
      pause() { /* noop */ },
      resume() { /* noop */ }
    }
  }
  return tracker
}

function makeEndpoint(dir: string, tag: string): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\oxespace-pty-a2-${tag}-${randomUUID()}`
    : join(dir, `oxespace-pty-${tag}.sock`)
}

function sendRawAndWaitForClose(endpoint: string, payload: string): Promise<{ received: string; closed: boolean }> {
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint)
    let received = ''
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        socket.destroy()
        resolve({ received, closed: false })
      }
    }, 1500)
    socket.on('connect', () => {
      socket.write(`${payload}\n`)
    })
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
    })
    socket.on('close', () => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ received, closed: true })
      }
    })
    socket.on('error', err => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    })
  })
}

describe('OXE-447 A2 — PTY daemon local-only auth, explicit shutdown, and idle auto-shutdown', () => {
  const cleanup: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn()
  })

  it('rejects non-local/TCP endpoints and refuses unauthorized connections with zero session data leaked', async () => {
    expect(() => assertLocalDaemonEndpoint('0.0.0.0:9229', 'win32')).toThrow()
    expect(() => assertLocalDaemonEndpoint('127.0.0.1:9229', 'linux')).toThrow()
    expect(() => assertLocalDaemonEndpoint('tcp://127.0.0.1:9229', 'linux')).toThrow()
    expect(() => assertLocalDaemonEndpoint('http://localhost:8080', 'darwin')).toThrow()

    const dir = mkdtempSync(join(tmpdir(), 'oxe447-a2-auth-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const endpoint = makeEndpoint(dir, 'auth')
    const token = generateDaemonToken()

    const secretOutput = 'TOP_SECRET_DAEMON_TOKEN_VALUE_9911'
    let spawnedFake: TrackedFakePty | null = null
    const server = createPtyDaemonServer({
      endpoint,
      token,
      pty: {
        spawn: () => {
          spawnedFake = makeFakePty(51515)
          return spawnedFake.pty
        }
      }
    })
    await server.listen()
    cleanup.push(() => server.close())

    if (process.platform !== 'win32') {
      const mode = statSync(endpoint).mode & 0o777
      expect(mode).toBe(0o600)
    }

    const authed = new DaemonPtyClient({ endpoint, token })
    await authed.connect()
    cleanup.push(() => authed.detachClient())
    await authed.spawnSession({ sessionId: 'secret-pane', file: 'sh', args: [], cwd: dir, cols: 80, rows: 24 })
    spawnedFake!.emitData(`${secretOutput}\r\n`)
    await new Promise(resolve => setTimeout(resolve, 30))

    // 1. Missing hello handshake: trying to listSessions directly is closed immediately.
    const noAuth = await sendRawAndWaitForClose(endpoint, JSON.stringify({ id: 1, type: 'listSessions' }))
    expect(noAuth.closed).toBe(true)
    expect(noAuth.received).not.toContain(secretOutput)
    expect(noAuth.received).not.toContain('secret-pane')

    // 2. Wrong token rejected via timingSafeEqual and closed with zero session leakage.
    const wrongToken = generateDaemonToken()
    const badAuth = await sendRawAndWaitForClose(
      endpoint,
      JSON.stringify({ id: 2, type: 'hello', token: wrongToken, protocolVersion: PTY_DAEMON_PROTOCOL_VERSION })
    )
    expect(badAuth.closed).toBe(true)
    expect(badAuth.received).not.toContain(secretOutput)
    expect(badAuth.received).not.toContain('secret-pane')

    // 3. Wrong protocolVersion rejected and closed with zero session leakage.
    const badProto = await sendRawAndWaitForClose(
      endpoint,
      JSON.stringify({ id: 3, type: 'hello', token, protocolVersion: PTY_DAEMON_PROTOCOL_VERSION + 99 })
    )
    expect(badProto.closed).toBe(true)
    expect(badProto.received).not.toContain(secretOutput)
    expect(badProto.received).not.toContain('secret-pane')
  })

  it('terminates all active PTYs cleanly on explicit shutdown ("Quit & stop terminals")', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe447-a2-shut-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const endpoint = makeEndpoint(dir, 'shut')
    const token = generateDaemonToken()

    const fakes: TrackedFakePty[] = []
    const server = createPtyDaemonServer({
      endpoint,
      token,
      pty: {
        spawn: () => {
          const fake = makeFakePty(60000 + fakes.length)
          fakes.push(fake)
          return fake.pty
        }
      }
    })
    await server.listen()
    cleanup.push(() => server.close())

    const client = new DaemonPtyClient({ endpoint, token })
    await client.connect()
    await client.spawnSession({ sessionId: 'p1', file: 'sh', args: [], cwd: dir, cols: 80, rows: 24 })
    await client.spawnSession({ sessionId: 'p2', file: 'sh', args: [], cwd: dir, cols: 80, rows: 24 })
    expect(server.sessionCount()).toBe(2)

    const result = await client.shutdown()
    expect(result.terminated).toBe(2)
    expect(fakes.every(f => f.killed)).toBe(true)
    expect(server.sessionCount()).toBe(0)
  })

  it('auto-shuts down after idle timeout once zero sessions remain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe447-a2-idle-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    const endpoint = makeEndpoint(dir, 'idle')
    const token = generateDaemonToken()

    let idleTriggered = false
    let resolveIdle!: () => void
    const idlePromise = new Promise<void>(resolve => { resolveIdle = resolve })
    let fake: TrackedFakePty | null = null

    const server = createPtyDaemonServer({
      endpoint,
      token,
      idleShutdownMs: 120,
      onIdleShutdown: () => {
        idleTriggered = true
        resolveIdle()
      },
      pty: {
        spawn: () => {
          fake = makeFakePty(70001)
          return fake.pty
        }
      }
    })
    await server.listen()
    cleanup.push(() => server.close())

    const client = new DaemonPtyClient({ endpoint, token })
    await client.connect()
    cleanup.push(() => client.detachClient())
    await client.spawnSession({ sessionId: 'idle-test', file: 'sh', args: [], cwd: dir, cols: 80, rows: 24 })

    // While 1 session is active, idle shutdown MUST NOT trigger.
    await new Promise(resolve => setTimeout(resolve, 180))
    expect(idleTriggered).toBe(false)

    // Exit the last session -> 0 sessions remain -> idle auto-shutdown triggers.
    fake!.emitExit(0)
    await Promise.race([
      idlePromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Idle auto-shutdown did not trigger')), 1500))
    ])
    expect(idleTriggered).toBe(true)
    expect(server.sessionCount()).toBe(0)
  })
})
