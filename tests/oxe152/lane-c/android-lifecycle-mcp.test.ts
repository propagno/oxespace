// @vitest-environment node
// OXE-111 (part B): MCP tool registration, consent enforcement, and person_action_audit recording for
// oxespace_android_avd_start, oxespace_android_apk_install, oxespace_android_app_launch, oxespace_android_logcat_tail.
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/user-data', getAppPath: () => '/app', isPackaged: false, getVersion: () => '1.6.0' } }))

const { TOOL_REGISTRY, findTool } = await import('../../../electron/main/mcp-internal/tool-registry')
const { createLocalRpcServer } = await import('../../../electron/main/mcp-internal/local-rpc-server')
const { AndroidAgentAccess, AndroidDevices } = await import('../../../electron/main/services/android/android-devices')
const { ExecutionRegistry } = await import('../../../electron/main/services/execution-registry')
type AdbResult = import('../../../electron/main/services/android/android-devices').AdbResult

const SERIAL = 'emulator-5554'
const WORKSPACE = process.platform === 'win32' ? 'C:\\work\\app' : '/work/app'
const APK = process.platform === 'win32' ? 'C:\\work\\app\\build\\app-debug.apk' : '/work/app/build/app-debug.apk'

interface AuditRow {
  ts: number
  action: string
  target: string
  outcome: string
  code: string | null
}

function fakeDb() {
  const rows: AuditRow[] = []
  return {
    rows,
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          if (sql.includes('INSERT INTO person_action_audit')) {
            rows.push({
              ts: params[0] as number,
              action: params[1] as string,
              target: params[2] as string,
              outcome: params[3] as string,
              code: (params[4] as string | null) ?? null
            })
          }
          return { changes: 1 }
        },
        all: () => [],
        get: () => undefined
      }
    }
  }
}

async function rpcCall(
  port: number,
  token: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const body = JSON.stringify(payload)
  const raw = await new Promise<string>((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/rpc',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `Bearer ${token}`,
        ...headers
      }
    }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve(text))
    })
    req.on('error', reject)
    req.end(body)
  })
  return JSON.parse(raw) as Record<string, unknown>
}

function setupHarness(options: { approve?: boolean; visible?: boolean } = {}) {
  const adbCalls: string[][] = []
  const emulatorArgs: string[][] = []
  const asked: Array<{ action: string; device: string; target: string }> = []
  const openedPanels: Array<{ workspaceId: string; serial: string }> = []
  let startedEmulator = false

  const run = async (args: string[]): Promise<AdbResult> => {
    adbCalls.push(args)
    const line = args.join(' ')
    if (line === 'devices -l') {
      const stdout = startedEmulator
        ? `List of devices attached\n${SERIAL}          device product:sdk model:Pixel_8 transport_id:1\n`
        : 'List of devices attached\n\n'
      return { status: 0, stdout, stderr: '' }
    }
    if (line.includes('getprop ro.build.version.sdk')) return { status: 0, stdout: '36\n', stderr: '' }
    if (line.includes('emu avd name')) return { status: 0, stdout: 'Pixel_8_API_36\nOK\n', stderr: '' }
    if (line.includes('getprop sys.boot_completed')) return { status: 0, stdout: '1\n', stderr: '' }
    if (line.includes(' install ')) return { status: 0, stdout: 'Success\n', stderr: '' }
    if (line.includes(' monkey ')) return { status: 0, stdout: 'Events injected: 1\n', stderr: '' }
    if (line.includes(' logcat ')) return { status: 0, stdout: '11-24 10:00:00.001 I App: booted\n', stderr: '' }
    return { status: 1, stdout: '', stderr: `unexpected ${line}` }
  }
  const runEmulator = async (args: string[]): Promise<AdbResult> => {
    emulatorArgs.push(args)
    if (args[0] === '-list-avds') return { status: 0, stdout: 'Pixel_8_API_36\n', stderr: '' }
    startedEmulator = true
    return { status: 0, stdout: '', stderr: '', pid: 9001 }
  }
  const devices = new AndroidDevices({ run, runEmulator })
  const access = new AndroidAgentAccess({ devices, initialAllowed: options.visible === false ? [] : [SERIAL] })
  const executions = new ExecutionRegistry()
  const env = executions.register({ owner: { kind: 'pane', id: 'p1' }, workspaceId: 'w1', cwd: WORKSPACE })
  const db = fakeDb()
  const server = createLocalRpcServer({
    db: db as never,
    executions,
    workspaceServ: { get: (id: string) => id === 'w1' ? { id: 'w1', rootPath: WORKSPACE, name: 'app', panes: [] } : undefined, list: () => [] },
    androidDevices: () => devices,
    androidAccess: () => access,
    askAndroidLifecycle: async req => {
      asked.push({ action: req.action, device: req.device, target: req.target })
      return options.approve ?? true
    },
    openAndroidPanel: req => { openedPanels.push(req) }
  } as never)
  const token = 'c'.repeat(64)
  server.setToken(token)
  const authHeaders = {
    'x-oxe-workspace-id': 'w1',
    'x-oxe-execution-id': env.OXESPACE_EXECUTION_ID,
    'x-oxe-execution-token': env.OXESPACE_EXECUTION_TOKEN
  }
  return { server, token, authHeaders, adbCalls, emulatorArgs, asked, openedPanels, db }
}

describe('OXE-111 (B) · MCP registration, consent enforcement and person_action_audit', () => {
  it('registers all 4 Android lifecycle tools in TOOL_REGISTRY with strict schemas', () => {
    const names = TOOL_REGISTRY.map(entry => entry.descriptor.name)
    for (const tool of [
      'oxespace_android_avd_start',
      'oxespace_android_apk_install',
      'oxespace_android_app_launch',
      'oxespace_android_logcat_tail'
    ]) {
      expect(names).toContain(tool)
      expect(findTool(tool)).not.toBeNull()
    }
    expect(findTool('oxespace_android_logcat_tail')?.descriptor.annotations?.readOnlyHint).toBe(true)
  })

  it('executes all 4 tools via local RPC when approved, fences logcat output, and writes person_action_audit rows', async () => {
    const h = setupHarness({ approve: true })
    const { port } = await h.server.start(0)
    try {
      const avdRes = await rpcCall(port, h.token, {
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'oxespace_android_avd_start', arguments: { avdName: 'Pixel_8_API_36' } }
      }, h.authHeaders) as { result: { isError?: boolean; content: Array<{ text: string }> } }
      expect(avdRes.result.isError).toBeUndefined()
      expect(JSON.parse(avdRes.result.content[0].text)).toEqual({ ok: true, avdName: 'Pixel_8_API_36', serial: SERIAL })

      const apkRes = await rpcCall(port, h.token, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'oxespace_android_apk_install', arguments: { serial: SERIAL, apkPath: APK } }
      }, h.authHeaders) as { result: { isError?: boolean; content: Array<{ text: string }> } }
      expect(apkRes.result.isError).toBeUndefined()

      const launchRes = await rpcCall(port, h.token, {
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'oxespace_android_app_launch', arguments: { serial: SERIAL, packageName: 'com.example.app' } }
      }, h.authHeaders) as { result: { isError?: boolean; content: Array<{ text: string }> } }
      expect(launchRes.result.isError).toBeUndefined()

      const logcatRes = await rpcCall(port, h.token, {
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'oxespace_android_logcat_tail', arguments: { serial: SERIAL, maxLines: 50 } }
      }, h.authHeaders) as { result: { isError?: boolean; content: Array<{ text: string }> } }
      expect(logcatRes.result.isError).toBeUndefined()
      expect(logcatRes.result.content[0].text).toContain('[untrusted data from an Android device logcat')
      expect(logcatRes.result.content[0].text).toContain('booted')

      expect(h.asked).toEqual([
        { action: 'avd_start', device: 'Pixel_8_API_36', target: 'Pixel_8_API_36' },
        { action: 'apk_install', device: SERIAL, target: APK },
        { action: 'app_launch', device: SERIAL, target: 'com.example.app' }
      ])
      expect(h.db.rows.map(r => [r.action, r.target, r.outcome, r.code])).toEqual([
        ['android-avd-start', 'Pixel_8_API_36', 'ok', null],
        ['android-apk-install', SERIAL, 'ok', 'app-debug.apk'],
        ['android-app-launch', SERIAL, 'ok', 'com.example.app'],
        ['android-logcat-tail', SERIAL, 'ok', 'logcat']
      ])
    } finally {
      await h.server.stop()
    }
  })

  it('refuses mutating tools when consent is declined, runs zero commands, and audits refused outcomes', async () => {
    const h = setupHarness({ approve: false })
    const { port } = await h.server.start(0)
    try {
      for (const [id, name, args] of [
        [1, 'oxespace_android_avd_start', { avdName: 'Pixel_8_API_36' }],
        [2, 'oxespace_android_apk_install', { serial: SERIAL, apkPath: APK }],
        [3, 'oxespace_android_app_launch', { serial: SERIAL, packageName: 'com.example.app' }]
      ] as const) {
        const res = await rpcCall(port, h.token, {
          jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args }
        }, h.authHeaders) as { result: { isError?: boolean; content: Array<{ text: string }> } }
        expect(res.result.isError).toBe(true)
        expect(res.result.content[0].text).toContain('declined')
      }
      expect(h.adbCalls).toEqual([])
      expect(h.emulatorArgs.filter(args => args[0] !== '-list-avds')).toEqual([])
      expect(h.db.rows.map(r => [r.action, r.outcome])).toEqual([
        ['android-avd-start', 'refused'],
        ['android-apk-install', 'refused'],
        ['android-app-launch', 'refused']
      ])
    } finally {
      await h.server.stop()
    }
  })

  it('rejects unauthenticated callers and opens Android panel when Agents can see is off', async () => {
    const h = setupHarness({ approve: true, visible: false })
    const { port } = await h.server.start(0)
    try {
      const unauth = await rpcCall(port, h.token, {
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: { name: 'oxespace_android_logcat_tail', arguments: { serial: SERIAL } }
      }) as { result: { isError?: boolean; content: Array<{ text: string }> } }
      expect(unauth.result.isError).toBe(true)
      expect(unauth.result.content[0].text).toContain('authenticated')

      const hidden = await rpcCall(port, h.token, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: 'oxespace_android_logcat_tail', arguments: { serial: SERIAL } }
      }, h.authHeaders) as { result: { isError?: boolean; content: Array<{ text: string }> } }
      expect(hidden.result.isError).toBe(true)
      expect(hidden.result.content[0].text).toContain('Agents can see is off')
      expect(h.openedPanels).toEqual([{ workspaceId: 'w1', serial: SERIAL }])
    } finally {
      await h.server.stop()
    }
  })

  it('migration 106 widens person_action_audit with all 4 Android lifecycle actions', () => {
    const sql = readFileSync(join(process.cwd(), 'electron', 'main', 'db', 'migrations', '106_person_action_audit_android_lifecycle.sql'), 'utf8')
    for (const action of ['android-avd-start', 'android-apk-install', 'android-app-launch', 'android-logcat-tail']) {
      expect(sql).toContain(`'${action}'`)
    }
    expect(sql).toContain('PRAGMA user_version = 106;')
  })
})
