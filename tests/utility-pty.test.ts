import { describe, expect, test, vi } from 'vitest'
import { HOST_GONE_EXIT_CODE, type PtyHostEvent, type PtyHostRequest } from '../electron/main/services/terminal/pty-host-protocol'
import { utilityPtyModule, type PtyHostProcess } from '../electron/main/services/terminal/utility-pty'

/*
 * OXE-400 · node-pty in a utility process (OXESPACE_PTY_HOST=utility). The main side is an IPty proxy over messages;
 * these tests drive it with a fake host. The real host and the app are covered by e2e/perf/pty-rust-*.spec.ts.
 */
class FakeHost implements PtyHostProcess {
  readonly sent: PtyHostRequest[] = []
  killed = false
  private message: (event: PtyHostEvent) => void = () => undefined
  private exit: (code: number) => void = () => undefined
  postMessage(request: PtyHostRequest): void { this.sent.push(request) }
  onMessage(listener: (event: PtyHostEvent) => void): void { this.message = listener }
  onExit(listener: (code: number) => void): void { this.exit = listener }
  kill(): void { this.killed = true }
  emit(event: PtyHostEvent): void { this.message(event) }
  die(code: number): void { this.exit(code) }
}

function setup() {
  const hosts: FakeHost[] = []
  const hostExits: number[] = []
  const module = utilityPtyModule(() => { const host = new FakeHost(); hosts.push(host); return host }, code => hostExits.push(code))
  return { module, hosts, hostExits }
}

const OPTIONS = { name: 'xterm-256color', cols: 100, rows: 30, cwd: '/repo', env: { A: '1' } }

describe('the PTY host proxy (OXE-400)', () => {
  test('a spawn goes to the host, and the pid and foreground process come from it', () => {
    const { module, hosts } = setup()
    const pty = module.spawn('/bin/bash', ['-l'], OPTIONS)
    expect(hosts).toHaveLength(1)
    expect(hosts[0].sent).toEqual([{ t: 'spawn', id: 1, file: '/bin/bash', args: ['-l'], options: OPTIONS }])
    expect(pty.pid).toBe(0)
    expect(pty.process).toBe('/bin/bash')
    expect([pty.cols, pty.rows]).toEqual([100, 30])

    hosts[0].emit({ t: 'ready', pid: 4242 })
    hosts[0].emit({ t: 'spawned', id: 1, pid: 777, process: 'bash' })
    expect(pty.pid).toBe(777)
    expect(pty.process).toBe('bash')
    expect(module.hostPid()).toBe(4242)
    hosts[0].emit({ t: 'process', id: 1, process: 'vim' })
    expect(pty.process).toBe('vim')
  })

  test('output reaches every data listener, and a disposed listener gets nothing more', () => {
    const { module, hosts } = setup()
    const pty = module.spawn('/bin/bash', [], OPTIONS)
    const first: string[] = []
    const second: string[] = []
    const off = pty.onData(data => first.push(data))
    pty.onData(data => second.push(data))
    hosts[0].emit({ t: 'data', id: 1, data: 'hello' })
    off.dispose()
    hosts[0].emit({ t: 'data', id: 1, data: ' world' })
    expect(first).toEqual(['hello'])
    expect(second).toEqual(['hello', ' world'])
  })

  test('input, resize, clear, pause, resume and kill go to the host for that terminal', () => {
    const { module, hosts } = setup()
    module.spawn('/bin/bash', [], OPTIONS)
    const pty = module.spawn('/bin/zsh', [], OPTIONS)
    pty.write('ls\r')
    pty.write(Buffer.from('é'))
    pty.resize(120, 40)
    pty.clear()
    pty.pause()
    pty.resume()
    pty.kill('SIGTERM')
    expect(hosts[0].sent.slice(2)).toEqual([
      { t: 'write', id: 2, data: 'ls\r' },
      { t: 'write', id: 2, data: 'é' },
      { t: 'resize', id: 2, cols: 120, rows: 40 },
      { t: 'clear', id: 2 },
      { t: 'pause', id: 2 },
      { t: 'resume', id: 2 },
      { t: 'kill', id: 2, signal: 'SIGTERM' }
    ])
    expect([pty.cols, pty.rows]).toEqual([120, 40])
  })

  test('a terminal ends once, with its exit code, and nothing is sent for it afterwards', () => {
    const { module, hosts } = setup()
    const pty = module.spawn('/bin/bash', [], OPTIONS)
    const exits: Array<{ exitCode: number; signal?: number }> = []
    const data: string[] = []
    pty.onExit(event => exits.push(event))
    pty.onData(chunk => data.push(chunk))
    hosts[0].emit({ t: 'exit', id: 1, exitCode: 3, signal: 9 })
    hosts[0].emit({ t: 'exit', id: 1, exitCode: 0 })
    hosts[0].emit({ t: 'data', id: 1, data: 'late' })
    pty.write('ignored')
    expect(exits).toEqual([{ exitCode: 3, signal: 9 }])
    expect(data).toEqual([])
    expect(hosts[0].sent).toHaveLength(1)
  })

  test('CA-1: when the host process ends, every terminal it held ends and the next spawn starts a new host', () => {
    const { module, hosts, hostExits } = setup()
    const a = module.spawn('/bin/bash', [], OPTIONS)
    const b = module.spawn('/bin/bash', [], OPTIONS)
    const ended = vi.fn()
    a.onExit(ended)
    b.onExit(ended)
    hosts[0].die(134)
    expect(ended).toHaveBeenCalledTimes(2)
    expect(ended).toHaveBeenCalledWith({ exitCode: HOST_GONE_EXIT_CODE })
    expect(hostExits).toEqual([134])
    expect(module.hostPid()).toBe(0)

    const c = module.spawn('/bin/bash', [], OPTIONS)
    expect(hosts).toHaveLength(2)
    expect(hosts[1].sent).toEqual([{ t: 'spawn', id: 3, file: '/bin/bash', args: [], options: OPTIONS }])
    hosts[1].emit({ t: 'spawned', id: 3, pid: 9 })
    expect(c.pid).toBe(9)
  })

  test('a spawn the host could not make shows why and ends the terminal with code 1', () => {
    const { module, hosts } = setup()
    const pty = module.spawn('/no/such/shell', [], OPTIONS)
    const data: string[] = []
    const exits: Array<{ exitCode: number }> = []
    pty.onData(chunk => data.push(chunk))
    pty.onExit(event => exits.push(event))
    hosts[0].emit({ t: 'spawn-failed', id: 1, message: 'File not found: /no/such/shell' })
    expect(data.join('')).toContain('File not found: /no/such/shell')
    expect(exits).toEqual([{ exitCode: 1 }])
  })

  test('dispose ends the host process', () => {
    const { module, hosts } = setup()
    module.spawn('/bin/bash', [], OPTIONS)
    module.dispose()
    expect(hosts[0].killed).toBe(true)
  })
})
