// Frozen acceptance test for 1.5.2 OxeCode F3 (OXE program oxespace-152-code, phase F3, Jira OXE-107).
// Written by the planner; the executor must not edit it.
// Defect (real use, 13/11): with an AVD on and listed by `adb devices`, oxespace_device_screenshot answered "Android
// device service is unavailable." with no next step. Two causes found by the planner:
// 1. electron/main/mcp-internal/local-rpc-server.ts builds each call's ToolContext (~line 145) without `androidAccess`
//    and `askAndroidScreenshot`, although bootstrap.ts hands both in its deps: every call through the local RPC (the
//    only way agents reach the tool) sees no Android service.
// 2. electron/main/mcp-internal/tool-handlers.ts deviceScreenshot (~line 368) gives up before looking at adb, and
//    AndroidDevices.screencap throws a bare "Android screencap failed" for a stopped adb server, no device or no adb.
// Contract:
// - The local RPC passes deps.androidAccess and deps.askAndroidScreenshot into the ToolContext.
// - deviceScreenshot (handlers.deviceScreenshot): when the capture fails because the adb server is not running, it runs
//   `adb start-server` (and only that: never the emulator, never kill-server), retries the capture once and returns the
//   image. AndroidDevices' adb allowlist gains exactly ['start-server'].
// - No device: an error result that says no Android device is connected and what to do next (connect one or start one
//   from the Android device panel); the tool never starts an emulator (OXE-111 owns that, with consent).
// - adb missing: an error result that says adb was not found and how to set it up (Android SDK platform-tools,
//   ANDROID_HOME / ANDROID_SDK_ROOT or PATH).
import http from 'node:http'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/user-data', getAppPath: () => '/app', isPackaged: false, getVersion: () => '1.5.2' } }))

// The registry first: it imports the handlers, and importing the handlers alone meets that cycle half-built.
await import('../../../electron/main/mcp-internal/tool-registry')
const { handlers } = await import('../../../electron/main/mcp-internal/tool-handlers')
const { AndroidAgentAccess, AndroidDevices } = await import('../../../electron/main/services/android/android-devices')
const { ExecutionRegistry } = await import('../../../electron/main/services/execution-registry')
type AdbResult = import('../../../electron/main/services/android/android-devices').AdbResult

const SERIAL = 'emulator-5554'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const LISTED = `List of devices attached\n${SERIAL}          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1\n`
const DAEMON_DOWN = '* daemon not running; starting now at tcp:5037\nadb: cannot connect to daemon at tcp:5037: cannot connect to 127.0.0.1:5037'

function fakeAdb(answer: (args: string[], state: { serverUp: boolean }) => Partial<AdbResult>, serverUp = true) {
  const state = { serverUp }
  const calls: string[][] = []
  const emulator: string[][] = []
  const run = async (args: string[]): Promise<AdbResult> => {
    calls.push(args)
    if (args.length === 1 && args[0] === 'start-server') { state.serverUp = true; return { status: 0, stdout: '', stderr: '' } }
    return { status: 0, stdout: '', stderr: '', ...answer(args, state) }
  }
  const runEmulator = async (args: string[]): Promise<AdbResult> => { emulator.push(args); return { status: 0, stdout: '', stderr: '' } }
  return { run, runEmulator, calls, emulator }
}

const isScreencap = (args: string[]): boolean => args.join(' ') === `-s ${SERIAL} exec-out screencap -p`

function toolContext(adb: ReturnType<typeof fakeAdb>) {
  const devices = new AndroidDevices({ run: adb.run, runEmulator: adb.runEmulator })
  const access = new AndroidAgentAccess({ devices, initialAllowed: [SERIAL] })
  const execution = { id: 'execution-1', workspaceId: 'w1', paneId: 'p1', owner: { kind: 'pane' as const, id: 'p1' }, cwd: process.cwd() }
  return {
    workspaceId: 'w1', executionId: execution.id, executionToken: 'token',
    executions: { authenticate: () => execution },
    androidAccess: () => access,
    askAndroidScreenshot: async () => true
  } as never
}

const textOf = (result: { content: Array<{ type: string; text?: string }> }): string => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

describe('OXE-107 · device_screenshot gets the capture, or says the cause and the next step', () => {
  it('CA-1 · the local RPC hands device_screenshot the Android service, so it never answers "service is unavailable"', async () => {
    const { createLocalRpcServer } = await import('../../../electron/main/mcp-internal/local-rpc-server')
    const adb = fakeAdb(args => isScreencap(args) ? { stdout: PNG } : args[0] === 'devices' ? { stdout: LISTED } : {})
    const access = new AndroidAgentAccess({ devices: new AndroidDevices({ run: adb.run, runEmulator: adb.runEmulator }), initialAllowed: [SERIAL] })
    const executions = new ExecutionRegistry()
    const env = executions.register({ owner: { kind: 'pane', id: 'p1' }, workspaceId: 'w1', cwd: process.cwd() })
    const server = createLocalRpcServer({
      executions,
      workspaceServ: { get: () => undefined, list: () => [] },
      androidAccess: () => access,
      askAndroidScreenshot: async () => true
    } as never)
    const token = 'b'.repeat(64)
    server.setToken(token)
    const { port } = await server.start(0)
    try {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'oxespace_device_screenshot', arguments: { serial: SERIAL } } })
      const reply = await new Promise<string>((resolve, reject) => {
        const request = http.request({ host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers: {
          'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Authorization: `Bearer ${token}`,
          'x-oxe-workspace-id': 'w1', 'x-oxe-execution-id': env.OXESPACE_EXECUTION_ID, 'x-oxe-execution-token': env.OXESPACE_EXECUTION_TOKEN
        } }, response => { let text = ''; response.setEncoding('utf8'); response.on('data', chunk => { text += chunk }); response.on('end', () => resolve(text)) })
        request.on('error', reject)
        request.end(body)
      })
      expect(reply).not.toContain('service is unavailable')
      const result = (JSON.parse(reply) as { result: { content: Array<{ type: string; data?: string }> } }).result
      expect(result.content).toContainEqual(expect.objectContaining({ type: 'image', data: PNG.toString('base64') }))
    } finally { await server.stop() }
  })

  it('CA-1 · with the adb server down, the tool starts only the adb server, retries once and returns the capture', async () => {
    const adb = fakeAdb((args, state) => {
      if (!state.serverUp) return { status: 1, stdout: '', stderr: DAEMON_DOWN }
      if (isScreencap(args)) return { stdout: PNG }
      if (args[0] === 'devices') return { stdout: LISTED }
      return {}
    }, false)
    const result = await handlers.deviceScreenshot({ serial: SERIAL }, toolContext(adb))
    expect(result.isError).toBe(false)
    expect(result.content).toContainEqual({ type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' })
    expect(adb.calls.filter(args => args[0] === 'start-server')).toHaveLength(1)
    expect(adb.calls.filter(isScreencap)).toHaveLength(2)
    // Only the adb server: nothing that stops it, and no emulator.
    expect(adb.calls.filter(args => args[0] !== '-s' && args[0] !== 'devices' && args[0] !== 'start-server')).toEqual([])
    expect(adb.emulator).toEqual([])
  })

  it('CA-2 · with no device connected, the answer names the cause and the next step, and no emulator starts', async () => {
    const adb = fakeAdb(args => {
      if (isScreencap(args)) return { status: 1, stdout: '', stderr: `adb: device '${SERIAL}' not found` }
      if (args[0] === 'devices') return { stdout: 'List of devices attached\n\n' }
      return {}
    })
    const result = await handlers.deviceScreenshot({ serial: SERIAL }, toolContext(adb))
    expect(result.isError).toBe(true)
    const text = textOf(result)
    expect(text).not.toContain('service is unavailable')
    expect(text).toMatch(/no (connected )?android device|no device is connected|not connected/i)
    expect(text).toMatch(/Android device panel|connect (a|the) device|start (an|the) emulator/i)
    expect(adb.emulator).toEqual([])
  })

  it('CA-3 · with adb not found, the answer says so and how to set it up', async () => {
    const adb = fakeAdb(() => ({ status: null, stdout: '', stderr: '', missing: true }))
    const result = await handlers.deviceScreenshot({ serial: SERIAL }, toolContext(adb))
    expect(result.isError).toBe(true)
    const text = textOf(result)
    expect(text).not.toContain('service is unavailable')
    expect(text).toMatch(/adb/i)
    expect(text).toMatch(/not found/i)
    expect(text).toMatch(/platform-tools|ANDROID_HOME|ANDROID_SDK_ROOT|PATH/)
    expect(adb.emulator).toEqual([])
  })
})
