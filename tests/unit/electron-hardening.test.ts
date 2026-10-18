// @vitest-environment node
/**
 * Static guard for the Electron security posture described in docs/SECURITY_MODEL.md.
 * It reads the main-process sources, so a change that weakens a window fails here
 * before it can reach a build. It does not replace reviewing the change: it only
 * makes the most dangerous edits impossible to make by accident.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SKIP = new Set(['vendor', 'e2e', 'node_modules'])

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    if (SKIP.has(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|cts|mts)$/.test(name) ? [path] : []
  })
}

const files = [...sources(join(ROOT, 'electron', 'main')), ...sources(join(ROOT, 'electron', 'preload'))]
const text = new Map(files.map(file => [relative(ROOT, file).replace(/\\/g, '/'), readFileSync(file, 'utf8')]))

/** Returns the `{ ... }` text that follows each `webPreferences:` key, braces balanced. */
function webPreferencesBlocks(source: string): string[] {
  const blocks: string[] = []
  for (const match of source.matchAll(/webPreferences\s*:\s*\{/g)) {
    let depth = 0
    let end = match.index! + match[0].length - 1
    for (; end < source.length; end++) {
      if (source[end] === '{') depth++
      else if (source[end] === '}' && --depth === 0) break
    }
    blocks.push(source.slice(match.index! + match[0].length - 1, end + 1))
  }
  return blocks
}

const collapse = (value: string): string => value.replace(/\s+/g, '')

describe('Electron hardening', () => {
  test('finds the windows and views it is supposed to guard', () => {
    const owners = [...text].filter(([, source]) => webPreferencesBlocks(source).length > 0).map(([file]) => file)
    expect(owners).toContain('electron/main/index.ts')
    expect(owners).toContain('electron/main/services/browser-preview.service.ts')
  })

  test('every webPreferences block isolates the context, disables Node and enables the sandbox', () => {
    for (const [file, source] of text) {
      for (const block of webPreferencesBlocks(source)) {
        const flat = collapse(block)
        expect(flat, `${file}: contextIsolation`).toContain('contextIsolation:true')
        expect(flat, `${file}: nodeIntegration`).toContain('nodeIntegration:false')
        expect(flat, `${file}: sandbox`).toContain('sandbox:true')
      }
    }
  })

  test('nothing turns a protection off anywhere in the main process or the preload', () => {
    const forbidden = [
      /webSecurity\s*:\s*false/,
      /allowRunningInsecureContent\s*:\s*true/,
      /nodeIntegration\s*:\s*true/,
      /nodeIntegrationInSubFrames\s*:\s*true/,
      /nodeIntegrationInWorker\s*:\s*true/,
      /contextIsolation\s*:\s*false/,
      /sandbox\s*:\s*false/,
      /enableRemoteModule/,
      /experimentalFeatures\s*:\s*true/
    ]
    for (const [file, source] of text) {
      for (const pattern of forbidden) expect(source, `${file} matches ${pattern}`).not.toMatch(pattern)
    }
  })

  test('the <webview> attach guard still forces the safe flags and the design-guest preload', () => {
    const main = collapse(text.get('electron/main/index.ts') ?? '')
    const guard = main.slice(main.indexOf("'will-attach-webview'"))
    expect(guard.length).toBeGreaterThan(0)
    expect(guard).toContain('webPreferences.preload=DESIGN_GUEST_PRELOAD')
    expect(guard).toContain('webPreferences.nodeIntegration=false')
    expect(guard).toContain('webPreferences.contextIsolation=true')
    expect(guard).toContain('webPreferences.sandbox=true')
    // The renderer may not pick a persistent partition: it is replaced unless it is a preview one.
    expect(guard).toContain('params.partition=')
  })

  test('the guard is not a no-op: a window that weakens a flag is detected by the same check', () => {
    const weakened = webPreferencesBlocks('new BrowserWindow({ webPreferences: { contextIsolation: true, nodeIntegration: true, sandbox: true } })')
    expect(weakened).toHaveLength(1)
    expect(collapse(weakened[0])).not.toContain('nodeIntegration:false')
  })
})
