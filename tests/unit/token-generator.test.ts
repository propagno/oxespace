// Frozen acceptance test for 1.5.2 OxeCode F4 (OXE program oxespace-152-code, phase F4, task T18, Jira OXE-137).
// Written by the planner; the executor must not edit it. T17 (tests/unit/token-bridge.test.ts) emptied the bridge of
// every family but --fs, --tx, --bd and --dot; T18 is that last lot, under the coordination's Q-10 answer ("c then a,
// net <= 0") and the brand session's names (oxespace-3d, 14/11): the bridge's short prefixes become the generated
// canonical names of those roles, in one layer, never as aliases. Only src/design/tokens/css.ts (the CSS emission)
// changes; the keys of scales.ts and semantic.ts, and so the phone's Kotlin (OxeTokens.kt), stay as they are.
// Contract:
// - "nomes curtos canônicos" (CA-2): tokensCss() emits --fs-{2xs,xs,sm,md,lg,xl,display}, --tx-{primary, secondary,
//   muted, disabled, on-accent, on-solid, on-identity, accent, link} and --bd-{default, subtle, strong, focus} in place of
//   --text-* and --border-* with the same suffixes, in every block the long name had (static, light, dark, the system
//   dark fallback, the comfortable density, more contrast), each with the value the source gives that role
//   (TEXT, colorRoles, moreContrastTokens). The long names are declared nowhere any more; --intent-*-solid stays; the
//   generated CSS holds no alias (no second bridge).
// - "nenhum leitor do nome longo" (CA-2): no file in src/ reads a long name any more (the codemod renamed every reader:
//   ~2300 on main), and every --fs-/--tx-/--bd- name read in src/ is declared by tokensCss() or is the bridge's --fs-2xl.
// - "catraca do último lote" (CA-1, CA-5): the bridge declares only --fs-2xl (22px, outside the scale): it leaves when the
//   titles that read it move to the scale in their BRDs (BRD-05, BRD-06...), not here, since that would change a value.
//   So "a ponte acabou" stays a todo in tests/unit/token-bridge.test.ts; no other snapshot name comes back.
// - The bridge names' mapping (--fs-base -> --fs-md; --bd-divider/-sidebar/-input/-base -> --bd-default; --bd-input-focus
//   -> --bd-focus; --dot-* -> the --intent-*-solid tokens, --dot-gray -> --tx-disabled; --bd-pane-active inlined in its
//   one reader) is checked by tests/unit/token-bridge.test.ts ("nenhum valor muda"), so RETIRED_TOKEN_NAMES
//   (src/design/tokens/retired.ts) lists each retired bridge name and each renamed long name ("--text-sm": "--fs-sm").
// - Kotlin unchanged: tests/android-generated.test.ts is in the verify. Budget (CA-3): each family at most +1 kB raw CSS
//   against main and the card at net <= 0 kB (CI [bundle] line). CA-4 end to end: desktop and phone goldens unchanged.
// The CSS is the product here, so reading it as text is the behaviour under test, not a source-text proxy (allowed).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { moreContrastTokens, tokensCss } from '../../src/design/tokens/css'
import { surfaceColorRoles } from '../../src/design/tokens/semantic'
import { TEXT } from '../../src/design/tokens/scales'

const root = process.cwd()
const SIZES = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', 'display'] as const
const COLORS = ['primary', 'secondary', 'muted', 'disabled', 'on-accent', 'on-solid', 'on-identity', 'accent', 'link'] as const
const BORDERS = ['default', 'subtle', 'strong', 'focus'] as const
const RENAMES: Array<[long: string, short: string, role: 'size' | 'color']> = [
  ...SIZES.map(size => [`--text-${size}`, `--fs-${size}`, 'size'] as [string, string, 'size']),
  ...COLORS.map(name => [`--text-${name}`, `--tx-${name}`, 'color'] as [string, string, 'color']),
  ...BORDERS.map(name => [`--border-${name}`, `--bd-${name}`, 'color'] as [string, string, 'color'])
]
const NAMES = Object.keys((JSON.parse(readFileSync(join(root, 'tests/fixtures/token-bridge-snapshot.json'), 'utf8')) as { names: Record<string, unknown> }).names)
/** The last lot leaves the bridge but --fs-2xl, which waits for the BRDs that move its titles to the scale. */
const BRIDGE_CAP = 1

interface Declaration { selector: string; name: string; value: string }
function declarationsIn(css: string): Declaration[] {
  const out: Declaration[] = []
  const stack: string[] = []
  let buffer = ''
  const collect = (chunk: string): void => {
    const found = /^\s*(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(chunk)
    if (found) out.push({ selector: stack.join(' '), name: found[1], value: found[2].trim() })
  }
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '{') { stack.push(buffer.trim()); buffer = '' } else if (char === '}') { collect(buffer); stack.pop(); buffer = '' } else if (char === ';') { collect(buffer); buffer = '' } else buffer += char
  }
  return out
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : /\.(css|tsx?)$/.test(name) ? [relative(root, path).split('\\').join('/')] : []
  })
}

const generatedCss = tokensCss()
const generated = declarationsIn(generatedCss)
const generatedNames = new Set(generated.map(item => item.name))
const BRIDGE = join(root, 'src/styles/tokens.css')
const bridge = existsSync(BRIDGE) ? declarationsIn(readFileSync(BRIDGE, 'utf8')) : []
const SOURCES = walk(join(root, 'src')).filter(path => path !== 'src/styles/tokens.generated.css' && path !== 'src/styles/tokens.css')
const TEXT_OF = new Map(SOURCES.map(path => [path, readFileSync(join(root, path), 'utf8')]))

/** What the source says a role is in the block `selector` of the generated CSS. */
function expected(long: string, role: 'size' | 'color', selector: string): string | undefined {
  const key = long.slice(2)
  const dark = /dark/.test(selector)
  const surface = /data-surface=['"]?pure/.test(selector) ? 'pure' : 'default'
  if (role === 'size') {
    const step = TEXT[key.slice('text-'.length) as keyof typeof TEXT]
    return /data-density=['"]?comfortable/.test(selector) ? `${step + 1}px` : `${step}px`
  }
  if (/prefers-contrast/.test(selector)) return moreContrastTokens(dark ? 'dark' : 'light', surface)[key]
  return surfaceColorRoles(dark ? 'dark' : 'light', surface)[key]
}

describe('OXE-137 T18 · the last lot: short canonical names from the generator', () => {
  test('nomes curtos canônicos: tokensCss() emits --fs, --tx and --bd in place of --text and --border, same values, no alias (OXE-137 CA-2)', () => {
    for (const [long, short, role] of RENAMES) {
      expect(generatedNames.has(long), `${long} is still generated`).toBe(false)
      const shorts = generated.filter(item => item.name === short)
      expect(shorts.length, `${short} is not generated`).toBeGreaterThan(0)
      for (const item of shorts) expect(item.value, `${short} in ${item.selector}`).toBe(expected(long, role, item.selector))
    }
    // Every block that held a long name holds its short name: sizes in the static block and the comfortable density,
    // colors and borders in light, dark and the system-dark fallback, and in more contrast where it raises them.
    const blocks = (name: string) => generated.filter(item => item.name === name).map(item => item.selector)
    for (const size of SIZES) {
      expect(blocks(`--fs-${size}`).some(selector => /^:root$/.test(selector)), `--fs-${size} in :root`).toBe(true)
      if (size !== 'xl' && size !== 'display') expect(blocks(`--fs-${size}`).some(selector => /comfortable/.test(selector)), `--fs-${size} in the comfortable density`).toBe(true)
    }
    for (const [long, short, role] of RENAMES) {
      if (role !== 'color') continue
      const selectors = blocks(short)
      // OXE-459: light, dark, system-dark fallback, light pure (Light White) and dark pure (True Black OLED).
      expect(selectors.filter(selector => !/prefers-contrast/.test(selector)).length, `${short} in light, dark, system-dark fallback, light pure and dark pure`).toBe(5)
      const raised = Object.keys(moreContrastTokens('light')).includes(long.slice(2))
      expect(selectors.filter(selector => /prefers-contrast/.test(selector)).length, `${short} under more contrast`).toBe(raised ? 4 : 0)
    }
    for (const intent of ['success', 'warning', 'danger', 'info']) expect(generatedNames.has(`--intent-${intent}-solid`), `--intent-${intent}-solid`).toBe(true)
    const aliases = [...generatedCss.matchAll(/(--[\w-]+)\s*:\s*var\(\s*--[\w-]+\s*\)\s*;/g)].map(found => found[1])
    expect(aliases, 'the generated CSS must not alias one token to another (a second bridge)').toEqual([])
  })

  test('nenhum leitor do nome longo: no file in src/ reads --text-* or --border-* names, and every short read is declared (OXE-137 CA-2)', () => {
    const long = new RegExp(`(${RENAMES.map(([name]) => name).join('|')})(?![\\w-])`, 'g')
    const left = SOURCES.flatMap(path => [...new Set([...TEXT_OF.get(path)!.matchAll(long)].map(found => found[1]))].map(name => `${name} in ${path}`))
    expect(left, 'long names still read or set in src/').toEqual([])
    const shortReads = new Set(SOURCES.flatMap(path => [...TEXT_OF.get(path)!.matchAll(/var\(\s*(--(?:fs|tx|bd)-[\w-]+)/g)].map(found => found[1])))
    for (const name of shortReads) expect(generatedNames.has(name) || bridge.some(item => item.name === name), `${name} is read in src/ but declared nowhere`).toBe(true)
  })

  test('catraca do último lote: the bridge keeps only --fs-2xl, and no retired name comes back (OXE-137 CA-1, CA-5)', () => {
    expect(bridge.length, 'declarations left in the bridge').toBeLessThanOrEqual(BRIDGE_CAP)
    for (const item of bridge) {
      expect(item.name, 'only --fs-2xl waits for its BRDs').toBe('--fs-2xl')
      expect(item.value).toBe('22px')
    }
    for (const name of NAMES.filter(item => item !== '--fs-2xl')) expect(bridge.some(item => item.name === name), `${name} came back to the bridge`).toBe(false)
  })
})
