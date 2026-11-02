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
// through e2eMocksEnabled, or check isPackaged itself and be added here with its exact guard.
const OWN_PACKAGED_CHECK: Record<string, RegExp> = {
  'e2e/mcp-fixture.ts': /mcpFixtureMode\(env[^)]*isPackaged: boolean\)[^{]*\{\s*if \(isPackaged\) return null/,
  'e2e/agent-state-hook.ts': /e2eAgentStateEnabled\(env[^)]*isPackaged: boolean\)[^{]*\{\s*if \(isPackaged\) return false/,
  'services/browser-preview-security.ts': /packaged = app\.isPackaged\)[^{]*\{\s*if \(packaged \|\| env\.OXESPACE_E2E_GUEST_PROBE !== '1'\) return \{\}/,
  'services/approvals/timeout.ts': /approvalTimeoutMs\(env[^)]*isPackaged: boolean\)[^{]*\{\s*if \(isPackaged\) return APPROVAL_TIMEOUT_MS/,
}
// Every other file in electron/main/e2e is mock layer: it only runs when loaded, and the check below lets nothing
// outside that folder load one of them except index.ts inside the switch. A new mock (e2e/open-in-mock.ts, #454)
// needs no change here.
const isMockLayer = (file: string): boolean => file.startsWith('e2e/') && file !== 'e2e/e2e-mode.ts'
const THROUGH_SWITCH = new Set(['index.ts', 'window-close-guard.ts', 'ipc/agent.ipc.ts', 'updater.ts'])
const SWITCH = 'e2eMocksEnabled(process.env, app.isPackaged)'
// Any load of an electron/main/e2e module other than the switch itself (e2e-mode), static, dynamic or require.
const MOCK_MODULE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"`][^'"`]*\be2e\/(?!e2e-mode['"`])[\w.-]+['"`]/g

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(?:[cm]?[jt]sx?)$/.test(name) ? [path] : []
  })
}

/**
 * The source without its whole-line comments: lines that start with `//`, `/*`, `*` or `*\/`. A comment after code on
 * the same line is kept, on purpose: telling it apart from a string or regex needs a parser, and keeping it can only
 * make the check stricter, never hide a real read.
 */
function withoutComments(source: string): string {
  return source.split('\n').map(line => (/^\s*(?:\/\/|\/\*|\*)/.test(line) ? '' : line)).join('\n')
}

/** The body of the first `if (<condition>) {` block, matched by braces. */
function blockAfter(text: string, condition: string): string {
  const start = text.indexOf(`if (${condition}) {`)
  if (start < 0) return ''
  let depth = 0
  for (let index = text.indexOf('{', start); index < text.length; index++) {
    if (text[index] === '{') depth++
    else if (text[index] === '}' && --depth === 0) return text.slice(start, index + 1)
  }
  return ''
}

describe('every OXESPACE_E2E_* read in electron/main', () => {
  const root = join(process.cwd(), 'electron', 'main')
  // Comments name variables without reading them; strings and code are kept, so a real read is never hidden.
  const all = sources(root).map(path => ({ file: relative(root, path).split(sep).join('/'), text: withoutComments(readFileSync(path, 'utf8')) }))
  // A read is the name itself, or one built from pieces ('OXESPACE_' + …, `OXESPACE_${…}`).
  const reads = all.filter(source => source.file !== 'e2e/e2e-mode.ts' && /OXESPACE_E2E_|['"`]OXESPACE_['"`]\s*\+|`OXESPACE_\$\{/.test(source.text))

  it('sits in a file that is guarded against a packaged build', () => {
    const unknown = reads.map(read => read.file).filter(file => !(file in OWN_PACKAGED_CHECK) && !isMockLayer(file) && !THROUGH_SWITCH.has(file))
    expect(unknown).toEqual([])
  })

  it('reads the mock switch only through e2eMocksEnabled outside the e2e folder', () => {
    for (const file of THROUGH_SWITCH) {
      const text = all.find(source => source.file === file)!.text
      expect(text, file).toContain(SWITCH)
      // No other E2E name in these files, however it is written; index.ts keeps PREVIEW_SERVICE inside the switch.
      const names = [...text.matchAll(/OXESPACE_E2E_[A-Z_]*/g)].map(match => match[0])
      expect(names, file).toEqual(file === 'index.ts' ? ['OXESPACE_E2E_PREVIEW_SERVICE'] : [])
      expect(text, file).not.toMatch(/['"`]OXESPACE_['"`]\s*\+|`OXESPACE_\$\{/)
    }
    expect(blockAfter(all.find(source => source.file === 'index.ts')!.text, SWITCH)).toContain('OXESPACE_E2E_PREVIEW_SERVICE')
    for (const [file, guard] of Object.entries(OWN_PACKAGED_CHECK)) {
      expect(all.find(source => source.file === file)?.text, file).toMatch(guard)
    }
    // The approvals timeout is only as safe as its caller: without an Electron app it must assume a packaged build.
    expect(all.find(source => source.file === 'services/approvals/index.ts')?.text).toContain('approvalTimeoutMs(process.env, app?.isPackaged ?? true)')
  })

  it('loads the E2E modules only inside the switch, from any file', () => {
    const outside = all
      .filter(source => !source.file.startsWith('e2e/'))
      .flatMap(source => {
        const text = source.file === 'index.ts' ? source.text.replace(blockAfter(source.text, SWITCH), '') : source.text
        return [...text.matchAll(MOCK_MODULE)].map(match => `${source.file}: ${match[0]}`)
      })
    expect(outside).toEqual([])
    expect(blockAfter(all.find(source => source.file === 'index.ts')!.text, SWITCH)).toContain("import('./e2e/mock-ipc')")
  })
})
