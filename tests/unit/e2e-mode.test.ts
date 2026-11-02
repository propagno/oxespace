// @vitest-environment node
// T48: a packaged build never loads the E2E doubles, whatever the environment says.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { e2eMocksEnabled } from '../../electron/main/e2e/e2e-mode'
import { mcpFixtureMode } from '../../electron/main/e2e/mcp-fixture'
import { e2eAgentStateEnabled } from '../../electron/main/e2e/agent-state-hook'

const MOCKS_ON = { OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_MCP_FIXTURE: 'quarantine', OXESPACE_E2E_AGENT_STATE: '1' }

describe('the E2E switch', () => {
  it('is off in a packaged build even with every E2E variable set', () => {
    expect(e2eMocksEnabled(MOCKS_ON, true)).toBe(false)
    expect(mcpFixtureMode(MOCKS_ON, true)).toBeNull()
    expect(e2eAgentStateEnabled(MOCKS_ON, true)).toBe(false)
  })

  it('is on only for an unpackaged run that asks for the mocks', () => {
    expect(e2eMocksEnabled(MOCKS_ON, false)).toBe(true)
    expect(e2eMocksEnabled({}, false)).toBe(false)
    expect(e2eMocksEnabled({ OXESPACE_E2E_MOCK_NATIVE: 'true' }, false)).toBe(false)
  })
})

// Where an OXESPACE_E2E_* read may live (the list in electron/main/e2e/e2e-mode.ts). A read anywhere else must go
// through e2eMocksEnabled, or check isPackaged itself and be added here with that check.
const OWN_PACKAGED_CHECK = new Set(['e2e/mcp-fixture.ts', 'e2e/agent-state-hook.ts', 'services/browser-preview-security.ts'])
const MOCK_LAYER_ONLY = new Set(['e2e/mock-ipc.ts', 'e2e/remote-mock.ts', 'e2e/approvals-mock.ts'])
const THROUGH_SWITCH = new Set(['index.ts', 'window-close-guard.ts', 'ipc/agent.ipc.ts', 'updater.ts'])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'vendor' ? [] : sources(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('every OXESPACE_E2E_* read in electron/main', () => {
  const root = join(process.cwd(), 'electron', 'main')
  const reads = sources(root)
    .map(path => ({ file: relative(root, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))
    .filter(source => /OXESPACE_E2E_[A-Z_]+/.test(source.text) && source.file !== 'e2e/e2e-mode.ts')

  it('sits in a file that is guarded against a packaged build', () => {
    const unknown = reads.map(read => read.file).filter(file => !OWN_PACKAGED_CHECK.has(file) && !MOCK_LAYER_ONLY.has(file) && !THROUGH_SWITCH.has(file))
    expect(unknown).toEqual([])
  })

  it('reads the mock switch only through e2eMocksEnabled outside the e2e folder', () => {
    for (const read of reads.filter(source => THROUGH_SWITCH.has(source.file))) {
      expect(read.text, read.file).not.toMatch(/process\.env\.OXESPACE_E2E_MOCK_NATIVE/)
      expect(read.text, read.file).toMatch(/e2eMocksEnabled\(process\.env, app\.isPackaged\)/)
    }
    for (const file of OWN_PACKAGED_CHECK) {
      expect(reads.find(read => read.file === file)?.text, file).toMatch(/isPackaged|packaged/)
    }
  })

  it('loads the mock layer only behind the switch', () => {
    const entry = reads.find(read => read.file === 'index.ts')!.text
    const switchAt = entry.indexOf('if (e2eMocksEnabled(process.env, app.isPackaged)) {')
    expect(switchAt).toBeGreaterThan(0)
    expect(entry.indexOf("import('./e2e/mock-ipc')")).toBeGreaterThan(switchAt)
    for (const read of reads.filter(source => !source.file.startsWith('e2e/') && source.file !== 'index.ts')) {
      expect(read.text, read.file).not.toMatch(/from '\.{1,2}\/(\.\.\/)*e2e\/(mock-ipc|remote-mock|approvals-mock)'/)
    }
  })
})
