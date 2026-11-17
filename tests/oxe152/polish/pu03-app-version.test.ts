// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-213, PU-03·11, CA-1, backend: the build's version define).
// Written by the planner; the executor must not edit it. The backend half of the card, before its interface (the version
// in About; never in the status bar, BRD-09 / OXE-72 CA-4).
// Today (main 4b7015c89) the renderer has no build-time version: AppStatusBar falls back to a hard-coded "1.5.0" when
// window.oxe.app.version is "dev" or empty, and Settings › About says "dev build".
// Contract:
// - src/lib/appVersion.ts (new) exports APP_VERSION: string, the value of the global __APP_VERSION__ (declared for
//   TypeScript in src/types/, e.g. src/types/app-version.d.ts), which is package.json's "version".
// - The define exists where the code runs: electron.vite.config.ts's renderer block defines __APP_VERSION__ as
//   JSON.stringify(<package.json>.version) (SOURCE-TEXT check, marked: the config's object is not importable in jsdom), and
//   vitest.config.ts defines the same, so the renderer's tests read the real number.
// - The value is never a literal version: neither config writes a version string.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../../src/lib/appVersion'

const ROOT = process.cwd()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
const source = (file: string): string => readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
/** The text of the object literal that follows `key:` in a config (brace-matched). */
function block(text: string, key: RegExp): string {
  const match = key.exec(text)
  if (!match) return ''
  const open = text.indexOf('{', match.index + match[0].length - 1)
  let depth = 1
  let index = open + 1
  while (index < text.length && depth > 0) { if (text[index] === '{') depth++; else if (text[index] === '}') depth--; index++ }
  return text.slice(open, index)
}

describe('OXE-213 PU-03·11 the renderer knows the installed version (backend)', () => {
  it('APP_VERSION is package.json\'s version', () => {
    expect(typeof APP_VERSION).toBe('string')
    expect(APP_VERSION).toBe(pkg.version)
    expect(APP_VERSION).not.toBe('dev')
  })

  it('electron.vite.config.ts defines __APP_VERSION__ for the renderer from package.json (source text, marked)', () => {
    const renderer = block(source('electron.vite.config.ts'), /\brenderer\s*:\s*\{/)
    expect(renderer.length, 'the renderer block').toBeGreaterThan(0)
    expect(renderer).toMatch(/__APP_VERSION__\s*:\s*JSON\.stringify\(\s*[\w.]+\.version\s*\)/)
  })

  it('vitest.config.ts defines the same, and neither config writes a version literal (source text, marked)', () => {
    const vitest = source('vitest.config.ts')
    expect(vitest).toMatch(/__APP_VERSION__\s*:\s*JSON\.stringify\(\s*[\w.]+\.version\s*\)/)
    for (const file of ['electron.vite.config.ts', 'vitest.config.ts']) expect(source(file), file).not.toMatch(/__APP_VERSION__\s*:\s*['"`]\d/)
  })
})
