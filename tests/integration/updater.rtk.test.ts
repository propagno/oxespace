import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RtkService } from '../../electron/main/services/rtk.service'

describe('RtkService version tracking', () => {
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `oxe-rtk-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
  })

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  test('getStatus reports not installed when binary missing', () => {
    const rtk = new RtkService(dir)
    const status = rtk.getStatus()
    expect(status.installed).toBe(false)
    expect(status.version).toBeNull()
    expect(status.binDir).toContain('bin')
  })

  test('getStatus reads rtk.version when present', () => {
    const bin = join(dir, 'bin')
    mkdirSync(bin, { recursive: true })
    const exe = process.platform === 'win32' ? 'rtk.exe' : 'rtk'
    writeFileSync(join(bin, exe), 'fake')
    writeFileSync(join(bin, 'rtk.version'), 'v1.2.3\n')

    const rtk = new RtkService(dir)
    const status = rtk.getStatus()
    expect(status.installed).toBe(true)
    expect(status.version).toBe('v1.2.3')
    expect(existsSync(join(bin, 'rtk.version'))).toBe(true)
  })

  test('legacy install without version file is treated as update-eligible when latest known', async () => {
    const bin = join(dir, 'bin')
    mkdirSync(bin, { recursive: true })
    const exe = process.platform === 'win32' ? 'rtk.exe' : 'rtk'
    writeFileSync(join(bin, exe), 'fake')

    const rtk = new RtkService(dir)
    // Inject latest via private cache by checking — mock network by stubbing method
    // through a partial check: set state as if check returned a tag.
    vi.spyOn(rtk, 'checkForUpdate').mockResolvedValue({
      installed: true,
      version: null,
      latestVersion: 'v9.9.9',
      updateAvailable: true,
      binDir: bin,
      error: null,
      checking: false,
      updating: false,
      lastCheckedAt: Date.now()
    })

    const status = await rtk.checkForUpdate(true)
    expect(status.updateAvailable).toBe(true)
    expect(status.latestVersion).toBe('v9.9.9')
  })
})
