// Frozen acceptance test for 1.5.2 OxeCode F4 (OXE program oxespace-152-code, phase F4, task T18, Jira OXE-137).
// Written by the planner; the executor must not edit it. T17 (tests/unit/token-bridge.test.ts) emptied the bridge of
// every family but the last lot; T18 is that lot, under the coordination's Q-10 answer, "c then a, net <= 0":
// (c) the token generator (src/design/tokens/css.ts, tokensCss) emits short canonical names for the --fs, --tx, --bd
// and --dot families, so the ~2100 reads keep short names, and (a) the four families leave the bridge one lot at a
// time (each PR at most +1 kB raw CSS against main, measured on CI by the [bundle] line), until the bridge is gone.
// Contract:
// - "nomes curtos canônicos" (CA-2): tokensCss() declares names of each of the four families. Every var() read in src/
//   of an --fs-/--tx-/--bd-/--dot- name resolves to a declaration of tokensCss() itself (not a component's), and the
//   generated CSS holds no alias (no declaration whose whole value is another custom property: not a second bridge).
//   The Kotlin of the phone stays generated from the same source: tests/android-generated.test.ts (committed
//   OxeTokens.kt unchanged) is in this task's verify.
// - "a ponte acabou" (CA-6): src/styles/tokens.css no longer exists, src/styles.css no longer imports it, and nothing in
//   src/ reads a name of the bridge snapshot (tests/fixtures/token-bridge-snapshot.json) that is declared nowhere.
// - The values of the names that left are checked by tests/unit/token-bridge.test.ts ("nenhum valor muda"), which reads
//   the bridge only when it exists. The card closes at net <= 0 kB raw CSS against the CSS before it (CI [bundle] line).
// The CSS is the product here, so reading it as text is the behaviour under test, not a source-text proxy (allowed).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { tokensCss } from '../../src/design/tokens/css'

const root = process.cwd()
const LAST_LOT = ['fs', 'tx', 'bd', 'dot'] as const
const NAMES = Object.keys((JSON.parse(readFileSync(join(root, 'tests/fixtures/token-bridge-snapshot.json'), 'utf8')) as { names: Record<string, unknown> }).names)

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : /\.(css|tsx?)$/.test(name) ? [relative(root, path).split('\\').join('/')] : []
  })
}

const SOURCES = walk(join(root, 'src')).filter(path => path !== 'src/styles/tokens.generated.css' && path !== 'src/styles/tokens.css')
const TEXT = new Map(SOURCES.map(path => [path, readFileSync(join(root, path), 'utf8')]))
const generatedCss = tokensCss()
const generated = new Set([...generatedCss.matchAll(/(--[\w-]+)\s*:/g)].map(found => found[1]))
const declaredInSrc = new Set(SOURCES.flatMap(path => [...TEXT.get(path)!.matchAll(/(--[\w-]+)\s*:|['"`](--[\w-]+)['"`](?:\s+as\s+\w+)?\s*\]?\s*[:,]/g)].map(found => found[1] ?? found[2])))
const reads = (name: string): string[] => SOURCES.filter(path => new RegExp(`var\\(\\s*${name}(?![\\w-])`).test(TEXT.get(path)!))

describe('OXE-137 T18 · the last lot leaves the bridge', () => {
  test('nomes curtos canônicos: the generator emits --fs, --tx, --bd and --dot names, and no alias (OXE-137 CA-2)', () => {
    for (const family of LAST_LOT) expect([...generated].some(name => name.startsWith(`--${family}-`)), `tokensCss() emits no --${family}-* name`).toBe(true)
    const shortReads = new Set(SOURCES.flatMap(path => [...TEXT.get(path)!.matchAll(/var\(\s*(--(?:fs|tx|bd|dot)-[\w-]+)/g)].map(found => found[1])))
    for (const name of shortReads) expect(generated.has(name), `${name} is read in src/ but tokensCss() does not declare it`).toBe(true)
    const aliases = [...generatedCss.matchAll(/(--[\w-]+)\s*:\s*var\(\s*--[\w-]+\s*\)\s*;/g)].map(found => found[1])
    expect(aliases, 'the generated CSS must not alias one token to another (a second bridge)').toEqual([])
  })

  test('a ponte acabou: the bridge file is gone and nothing in src/ reads a name only it declared (OXE-137 CA-6)', () => {
    expect(existsSync(join(root, 'src/styles/tokens.css')), 'src/styles/tokens.css still exists').toBe(false)
    expect(readFileSync(join(root, 'src/styles.css'), 'utf8')).not.toMatch(/tokens\.css['"]/)
    const dangling = NAMES.filter(name => !generated.has(name) && !declaredInSrc.has(name)).flatMap(name => reads(name).map(path => `${name} in ${path}`))
    expect(dangling, 'reads of a bridge name that nothing declares any more').toEqual([])
  })
})
