// Frozen acceptance test for 1.5.0 A52 / B3 (OXE program, phase F5), SECURITY: the Android mirror through the user's own
// adb (none bundled): the device list and its states, the person's taps mapped to device coordinates, "Agents can see"
// off by default and per device, and an agent screenshot that is refused while off and asks once per session when on.
// No input path exists for agents. A fake adb only; no device, no emulator, no network.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f5-see-agent.md §A52; DESIGN 1.5.0-f5-design.md U5.3.
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { AndroidAgentAccess, AndroidDevices, mapTap, type AdbRunner } from '../../../electron/main/services/android/android-devices'
import { TOOL_REGISTRY } from '../../../electron/main/mcp-internal/tool-registry'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'

interface Call { args: string[]; shell: boolean }
/** PNG signature plus a few bytes: kept exactly, end to end (HML-711-8). */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x0d, 0x0a, 0x1a, 0xff])
function fakeAdb(options: { missing?: boolean; devices?: string; wmSize?: string } = {}) {
  const calls: Call[] = []
  const run: AdbRunner = async (args, opts) => {
    calls.push({ args, shell: opts?.shell === true })
    if (options.missing) return { status: null, stdout: '', stderr: '', missing: true }
    const line = args.join(' ')
    if (line === 'devices -l') return { status: 0, stdout: options.devices ?? 'List of devices attached\nemulator-5554          device product:sdk_gphone64 model:Pixel_8 device:emu64a transport_id:1\nR5CT1234ABC            device usb:1-1 product:dm1q model:SM_S911B device:dm1q transport_id:2\n0A1B2C3D               unauthorized usb:1-2 transport_id:3\n\n', stderr: '' }
    if (line.endsWith('shell getprop ro.build.version.sdk')) return { status: 0, stdout: '36\n', stderr: '' }
    if (line.endsWith('shell wm size')) return { status: 0, stdout: options.wmSize ?? 'Physical size: 1080x2400\n', stderr: '' }
    if (line.includes('shell input tap')) return { status: 0, stdout: '', stderr: '' }
    if (line.includes('exec-out screencap -p')) return { status: 0, stdout: PNG, stderr: '' }
    return { status: 1, stdout: '', stderr: `unexpected ${line}` }
  }
  return { run, calls }
}

describe('A52 · the device list, from the user\'s adb', () => {
  test('A52: no adb on the PATH is adb missing; nothing is bundled or downloaded', async () => {
    const adb = fakeAdb({ missing: true })
    expect(await new AndroidDevices({ run: adb.run }).list()).toEqual({ adb: 'missing', devices: [] })
  })

  test('A52: emulators and USB phones with their name, kind, API and state; an unauthorized phone says so', async () => {
    const adb = fakeAdb()
    expect(await new AndroidDevices({ run: adb.run }).list()).toEqual({ adb: 'ok', devices: [
      { serial: 'emulator-5554', name: 'Pixel 8', kind: 'emulator', api: 36, state: 'device' },
      { serial: 'R5CT1234ABC', name: 'SM S911B', kind: 'usb', api: 36, state: 'device' },
      { serial: '0A1B2C3D', name: '0A1B2C3D', kind: 'usb', state: 'unauthorized' }
    ] })
  })

  test('A52: every adb call is an argument array, never a shell, with -s <serial> for a device; an option-like serial is refused', async () => {
    const adb = fakeAdb()
    const devices = new AndroidDevices({ run: adb.run })
    await devices.list()
    await devices.tap('emulator-5554', { x: 540, y: 1200 })
    expect(adb.calls.every(call => !call.shell)).toBe(true)
    expect(adb.calls.find(call => call.args.includes('tap'))?.args).toEqual(['-s', 'emulator-5554', 'shell', 'input', 'tap', '540', '1200'])
    const before = adb.calls.length
    for (const serial of ['-e', '--help', 'a b', 'x;rm -rf', '']) await expect(devices.tap(serial, { x: 1, y: 1 })).rejects.toThrow()
    expect(adb.calls).toHaveLength(before)
  })
})

describe('A52 · the person\'s input', () => {
  test('A52: a tap on the scaled canvas lands on the right device pixel, and rotation swaps the axes', () => {
    // A 1080 × 2400 phone shown at 270 × 600 on screen.
    expect(mapTap({ x: 135, y: 300 }, { width: 270, height: 600 }, { width: 1080, height: 2400 })).toEqual({ x: 540, y: 1200 })
    expect(mapTap({ x: 0, y: 0 }, { width: 270, height: 600 }, { width: 1080, height: 2400 })).toEqual({ x: 0, y: 0 })
    // Outside the frame is no tap.
    expect(mapTap({ x: 300, y: 10 }, { width: 270, height: 600 }, { width: 1080, height: 2400 })).toBeNull()
    expect(mapTap({ x: 600, y: 135 }, { width: 600, height: 270 }, { width: 2400, height: 1080 })).toEqual({ x: 2400 - 1, y: 540 })
  })
})

describe('A52 · agents and the device (SECURITY)', () => {
  test('A52: "Agents can see" is off by default, per device, and a screenshot is refused while off without asking', async () => {
    const adb = fakeAdb()
    const access = new AndroidAgentAccess({ devices: new AndroidDevices({ run: adb.run }) })
    const ask = vi.fn(async () => true)
    expect(access.agentsCanSee('emulator-5554')).toBe(false)
    expect(await access.screenshot({ serial: 'emulator-5554', sessionKey: 'exec-1', ask })).toEqual({ ok: false, code: 'android.agents.notAllowed' })
    expect(ask).not.toHaveBeenCalled()
    expect(adb.calls.some(call => call.args.includes('screencap'))).toBe(false)
  })

  test('A52: switched on, the first screenshot in a session asks once; the next ones do not; another device is still off', async () => {
    const adb = fakeAdb()
    const access = new AndroidAgentAccess({ devices: new AndroidDevices({ run: adb.run }) })
    const ask = vi.fn(async () => true)
    access.setAgentsCanSee('emulator-5554', true)
    for (let index = 0; index < 3; index++) expect(await access.screenshot({ serial: 'emulator-5554', sessionKey: 'exec-1', ask })).toMatchObject({ ok: true, png: expect.any(String) })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(await access.screenshot({ serial: 'R5CT1234ABC', sessionKey: 'exec-1', ask })).toEqual({ ok: false, code: 'android.agents.notAllowed' })
    // Another agent session asks again.
    await access.screenshot({ serial: 'emulator-5554', sessionKey: 'exec-2', ask })
    expect(ask).toHaveBeenCalledTimes(2)
  })

  test('A52: a denial captures nothing; switching off revokes at once, even for a session that was asked', async () => {
    const adb = fakeAdb()
    const access = new AndroidAgentAccess({ devices: new AndroidDevices({ run: adb.run }) })
    access.setAgentsCanSee('emulator-5554', true)
    expect(await access.screenshot({ serial: 'emulator-5554', sessionKey: 'exec-1', ask: async () => false })).toEqual({ ok: false, code: 'android.agents.denied' })
    expect(adb.calls.some(call => call.args.includes('screencap'))).toBe(false)
    expect((await access.screenshot({ serial: 'emulator-5554', sessionKey: 'exec-1', ask: async () => true })).ok).toBe(true)
    access.setAgentsCanSee('emulator-5554', false)
    expect(await access.screenshot({ serial: 'emulator-5554', sessionKey: 'exec-1', ask: async () => true })).toEqual({ ok: false, code: 'android.agents.notAllowed' })
  })

  test('A52: the agent tool is a read named oxespace_device_screenshot; no tool can send input to a device', () => {
    const names = TOOL_REGISTRY.map(entry => entry.descriptor.name)
    expect(names).toContain('oxespace_device_screenshot')
    const shot = TOOL_REGISTRY.find(entry => entry.descriptor.name === 'oxespace_device_screenshot')!
    expect(JSON.stringify(shot.descriptor.inputSchema)).not.toMatch(/tap|swipe|key|input|text/i)
    for (const name of names) expect(/device_(tap|input|swipe|key|type)|android_(tap|input)|adb/i.test(name), name).toBe(false)
    const claim = Object.values(MCP_COVERAGE).find(capability => 'tools' in capability && Object.hasOwn(capability.tools, 'oxespace_device_screenshot')) as { tools: Record<string, string> } | undefined
    expect(claim?.tools.oxespace_device_screenshot).toBe('read')
    // The person's controls are window channels, never tools.
    const input = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes('android.tap') || capability.ipc?.includes('android.*'))
    expect(input).toHaveLength(1)
    expect(input[0]).toHaveProperty('forbidden')
  })
})

describe('A52 · SECURITY S3, S4, S6 (TECH LEAD on #711)', () => {
  test('S3: only the subcommands the feature needs ever reach adb; everything else is refused before spawn, even from inside the app', async () => {
    const adb = fakeAdb()
    const devices = new AndroidDevices({ run: adb.run })
    const refused = [
      ['connect', '192.168.1.5:5555'], ['tcpip', '5555'], ['install', 'evil.apk'], ['uninstall', 'com.bank'], ['push', 'a', '/sdcard/a'], ['pull', '/sdcard/DCIM', '.'],
      ['root'], ['reboot'], ['-s', 'emulator-5554', 'shell', 'rm', '-rf', '/sdcard'], ['-s', 'emulator-5554', 'shell', 'am', 'start', 'x'], ['-s', 'emulator-5554', 'shell', 'input', 'text', 'pwd'],
      ['-s', 'emulator-5554', 'shell', 'input', 'keyevent', '26; reboot'], ['shell', 'getprop'], ['forward', 'tcp:1', 'tcp:2'], ['-s', 'emulator-5554', 'exec-out', 'cat', '/data/x']
    ]
    for (const args of refused) await expect(devices.adb(args), args.join(' ')).rejects.toThrow()
    expect(adb.calls).toEqual([])
    const allowed = [
      ['devices', '-l'], ['-s', 'emulator-5554', 'shell', 'getprop', 'ro.build.version.sdk'], ['-s', 'emulator-5554', 'shell', 'wm', 'size'],
      ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'], ['-s', 'emulator-5554', 'shell', 'input', 'tap', '1', '2'],
      ['-s', 'emulator-5554', 'shell', 'input', 'swipe', '1', '2', '3', '4', '120'], ['-s', 'emulator-5554', 'shell', 'input', 'keyevent', '4']
    ]
    for (const args of allowed) await devices.adb(args)
    expect(adb.calls.map(call => call.args)).toEqual(allowed)
  })

  test('S4: an agent screenshot goes only to the caller: no file is left in the app\'s folders, and the audit never holds the image', async () => {
    const adb = fakeAdb()
    const temp = mkdtempSync(join(tmpdir(), 'oxe-f5-shot-'))
    const audit: Array<Record<string, unknown>> = []
    const access = new AndroidAgentAccess({ devices: new AndroidDevices({ run: adb.run }), tempDir: temp, audit: { record: entry => { audit.push(entry) } } })
    access.setAgentsCanSee('emulator-5554', true)
    const shot = await access.screenshot({ serial: 'emulator-5554', sessionKey: 'exec-1', ask: async () => true })
    expect(shot.ok).toBe(true)
    if (shot.ok) expect(Buffer.from(shot.png, 'base64').equals(PNG)).toBe(true)
    expect(readdirSync(temp)).toEqual([])
    expect(JSON.stringify(audit)).not.toContain(PNG.toString('base64'))
  })

  test('S6: the Agents can see toggle writes one audit row per change, per device, with no content; the same value twice writes once', () => {
    const audit: Array<Record<string, unknown>> = []
    const access = new AndroidAgentAccess({ devices: new AndroidDevices({ run: fakeAdb().run }), audit: { record: entry => { audit.push(entry) } } })
    access.setAgentsCanSee('emulator-5554', true)
    access.setAgentsCanSee('emulator-5554', true)
    access.setAgentsCanSee('R5CT1234ABC', true)
    access.setAgentsCanSee('emulator-5554', false)
    expect(audit).toEqual([
      { action: 'android-agents-can-see', target: 'emulator-5554', outcome: 'on' },
      { action: 'android-agents-can-see', target: 'R5CT1234ABC', outcome: 'on' },
      { action: 'android-agents-can-see', target: 'emulator-5554', outcome: 'off' }
    ])
  })
})

describe('A52 · real adb output (HML 711)', () => {
  test('HML-711-6: daemon lines, CRLF, no-permissions, the other states and wireless serials are read; nothing keeps a stray \\r', async () => {
    const output = [
      '* daemon not running; starting now at tcp:5037', '* daemon started successfully', 'List of devices attached',
      'emulator-5554          device product:sdk_gphone64 model:Pixel_8 device:emu64a transport_id:1',
      '0A1B2C3D               no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-2 transport_id:3',
      'R5CT1234ABC            offline usb:1-1 transport_id:2', 'R5CT9999XYZ            recovery usb:1-3 transport_id:4', 'R5CT8888XYZ            sideload transport_id:5',
      'R5CT7777XYZ            authorizing usb:1-4 transport_id:6',
      '192.168.1.5:37199      device product:dm1q model:SM_S911B device:dm1q transport_id:7',
      'adb-R5CT1234-AbCdEf._adb-tls-connect._tcp device product:dm1q model:SM_S911B device:dm1q transport_id:8', ''
    ].join('\r\n')
    const list = await new AndroidDevices({ run: fakeAdb({ devices: output }).run }).list()
    expect(list.adb).toBe('ok')
    expect(list.devices.map(device => [device.serial, device.state])).toEqual([
      ['emulator-5554', 'device'], ['0A1B2C3D', 'no-permissions'], ['R5CT1234ABC', 'offline'], ['R5CT9999XYZ', 'recovery'], ['R5CT8888XYZ', 'sideload'],
      ['R5CT7777XYZ', 'authorizing'], ['192.168.1.5:37199', 'device'], ['adb-R5CT1234-AbCdEf._adb-tls-connect._tcp', 'device']
    ])
    expect(JSON.stringify(list)).not.toContain('\\r')
    expect(list.devices.find(device => device.serial === '192.168.1.5:37199')).toMatchObject({ kind: 'wifi', name: 'SM S911B' })
  })

  test('HML-711-7: a Samsung that prints Physical and Override taps in the Override resolution', async () => {
    const adb = fakeAdb({ wmSize: 'Physical size: 1080x2340\r\nOverride size: 720x1560\r\n' })
    const devices = new AndroidDevices({ run: adb.run })
    expect(await devices.size('emulator-5554')).toEqual({ width: 720, height: 1560 })
    expect(await new AndroidDevices({ run: fakeAdb().run }).size('emulator-5554')).toEqual({ width: 1080, height: 2400 })
  })
})
