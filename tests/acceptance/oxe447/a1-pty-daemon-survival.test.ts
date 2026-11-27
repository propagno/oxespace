import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IDisposable, IPty } from 'node-pty'
import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { DaemonPtyClient } from '../../../electron/main/services/terminal/daemon-pty'
import {
  PTY_DAEMON_PROTOCOL_VERSION,
  defaultPtyDaemonEndpoint,
  generateDaemonToken
} from '../../../electron/main/services/terminal/pty-daemon-protocol'
import { ptyHostMode } from '../../../electron/main/services/terminal/pty-host-protocol'
import {
  setTerminalQuitBehavior,
  terminalQuitBehavior
} from '../../../electron/main/services/terminal/quit-behavior-setting'
import { createPtyDaemonServer } from '../../../electron/main/workers/pty-daemon'

interface FakePtyController {
  pty: IPty
  writes: string[]
  resizes: Array<{ cols: number; rows: number }>
  killed: boolean
  emitData: (data: string) => void
  emitExit: (exitCode: number) => void
}

function createFakePty(pid: number, initialCols: number, initialRows: number): FakePtyController {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(e: { exitCode: number; signal?: number }) => void>()
  const writes: string[] = []
  const resizes: Array<{ cols: number; rows: number }> = []
  let cols = initialCols
  let rows = initialRows
  const controller: FakePtyController = {
    writes,
    resizes,
    killed: false,
    emitData(data: string) {
      for (const listener of dataListeners) listener(data)
    },
    emitExit(exitCode: number) {
      for (const listener of exitListeners) listener({ exitCode })
    },
    pty: {
      pid,
      get cols() { return cols },
      get rows() { return rows },
      process: 'fake-shell',
      handleFlowControl: false,
      onData(listener: (data: string) => void): IDisposable {
        dataListeners.add(listener)
        return { dispose: () => { dataListeners.delete(listener) } }
      },
      onExit(listener: (e: { exitCode: number; signal?: number }) => void): IDisposable {
        exitListeners.add(listener)
        return { dispose: () => { exitListeners.delete(listener) } }
      },
      write(data: string) {
        writes.push(data)
      },
      resize(nextCols: number, nextRows: number) {
        cols = nextCols
        rows = nextRows
        resizes.push({ cols: nextCols, rows: nextRows })
      },
      clear() { /* noop */ },
      kill() {
        controller.killed = true
      },
      pause() { /* noop */ },
      resume() { /* noop */ }
    }
  }
  return controller
}

function makeEndpoint(dir: string): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\oxespace-pty-a1-${randomUUID()}`
    : join(dir, 'oxespace-pty.sock')
}

describe('OXE-447 A1 — Detached PTY daemon restart survival & scrollback reattach', () => {
  const cleanup: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn()
  })

  it('keeps PTY alive across client detach/reconnect with same PID, DEC modes, and buffered detached output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe447-a1-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))

    const endpoint = makeEndpoint(dir)
    const token = generateDaemonToken()
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(defaultPtyDaemonEndpoint('user123', dir, 'win32')).toBe('\\\\.\\pipe\\oxespace-pty-user123')
    expect(defaultPtyDaemonEndpoint('user123', dir, 'linux')).toBe(join(dir, 'oxespace-pty.sock'))

    const fakePid = 42424
    let activeFake: FakePtyController | null = null
    const server = createPtyDaemonServer({
      endpoint,
      token,
      pty: {
        spawn: (_file, _args, options) => {
          activeFake = createFakePty(fakePid, options.cols ?? 80, options.rows ?? 24)
          return activeFake.pty
        }
      }
    })
    await server.listen()
    cleanup.push(() => server.close())

    const client1 = new DaemonPtyClient({ endpoint, token })
    const hello = await client1.connect()
    expect(hello.protocolVersion).toBe(PTY_DAEMON_PROTOCOL_VERSION)

    const spawned = await client1.spawnSession({
      sessionId: 'pane-survive-1',
      file: 'pwsh',
      args: [],
      cwd: dir,
      cols: 96,
      rows: 28
    })
    expect(spawned.pid).toBe(fakePid)
    expect(activeFake).not.toBeNull()

    // Emit DEC bracketed paste mode + pre-detach output while client1 is connected.
    activeFake!.emitData('\x1b[?2004hBEFORE_DETACH_LINE\r\n')
    await new Promise(resolve => setTimeout(resolve, 40))

    // Simulate app closing in "detach" mode: client disconnects WITHOUT killing PTY.
    await client1.detachClient()
    expect(activeFake!.killed).toBe(false)
    expect(server.sessionCount()).toBe(1)

    // Process keeps emitting output while no client is attached.
    activeFake!.emitData('DETACHED_OUTPUT_1\r\nDETACHED_OUTPUT_2\r\n')
    await new Promise(resolve => setTimeout(resolve, 40))

    // Simulate app restart: brand new client connects to the running daemon.
    const client2 = new DaemonPtyClient({ endpoint, token })
    await client2.connect()
    cleanup.push(() => client2.detachClient())

    const sessions = await client2.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      sessionId: 'pane-survive-1',
      pid: fakePid,
      cols: 96,
      rows: 28,
      alive: true
    })

    const attached = await client2.attachSession('pane-survive-1')
    expect(attached.session.pid).toBe(fakePid)
    expect(attached.prologue).toContain('\x1b[?2004h')
    const restoredOutput = `${attached.snapshot}\n${attached.ringTail}`
    expect(restoredOutput).toContain('BEFORE_DETACH_LINE')
    expect(restoredOutput).toContain('DETACHED_OUTPUT_1')
    expect(restoredOutput).toContain('DETACHED_OUTPUT_2')

    // Verify live streaming and input forwarding continue on the reattached IPty.
    const liveChunks: string[] = []
    attached.pty.onData(chunk => liveChunks.push(chunk))
    activeFake!.emitData('LIVE_AFTER_REATTACH\r\n')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(liveChunks.join('')).toContain('LIVE_AFTER_REATTACH')

    attached.pty.write('echo still-alive\r')
    attached.pty.resize(120, 40)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(activeFake!.writes).toContain('echo still-alive\r')
    expect(activeFake!.resizes).toContainEqual({ cols: 120, rows: 40 })
  })

  it('persists terminal quit behavior (detach vs kill) and supports OXESPACE_PTY_HOST=daemon with utility fallback', () => {
    const db = openInMemoryDatabase()
    cleanup.push(() => db.close())

    expect(terminalQuitBehavior(db)).toBe('kill')
    expect(setTerminalQuitBehavior(db, 'detach')).toBe('detach')
    expect(terminalQuitBehavior(db)).toBe('detach')
    expect(setTerminalQuitBehavior(db, 'kill')).toBe('kill')
    expect(terminalQuitBehavior(db)).toBe('kill')

    expect(ptyHostMode({})).toBe('utility')
    expect(ptyHostMode({ OXESPACE_PTY_HOST: 'daemon' })).toBe('daemon')
    expect(ptyHostMode({ OXESPACE_PTY_HOST: 'main' })).toBe('main')
    expect(ptyHostMode({ OXESPACE_PTY_HOST: 'utility' })).toBe('utility')
  })
})
