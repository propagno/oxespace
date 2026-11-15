// OXE-137 (1.5.2, OxeCode program F4, task T17): frozen acceptance cases added by the planner to the #802 ratchet;
// the executor must not edit this file. Its first version (#802) capped the bridge at 90 declarations.
// Contract (the bridge is src/styles/tokens.css; the snapshot is tests/fixtures/token-bridge-snapshot.json, its 89
// names on main 39c96cd43, each with the value it declared, the generated token(s) it resolved to and its kind):
// - "catraca só desce" (CA-1, CA-5): the bridge holds at most BRIDGE_CAP declarations, all of them from the last lot
//   (--fs, --tx, --bd, --dot) and all of them names of the snapshot; no name retired by #802 comes back.
// - "nenhum valor muda" (CA-4, CA-5): every snapshot name the bridge no longer declares either
//   (a) is still declared in src/ under the same name (a component's local variable, or a name the token generator
//       now emits) with the same value, or
//   (b) is read nowhere in src/ and is listed in RETIRED_TOKEN_NAMES, exported by src/design/tokens/retired.ts (created
//       by T17): legacy name -> the CSS custom property, or the CSS value, that replaced it.
//   An alias is compared by token, not by color, so it holds in both modes: what replaced it is the generated token the
//   snapshot names. A literal or a compound is compared by its declared value (whitespace aside; a var() of a snapshot
//   name counts as that name's snapshot value). RETIRED_TOKEN_NAMES may also list a generated name the generator renamed
//   (T18, the short canonical names): a token is then followed through it. A name a component sets from TS (App.tsx
//   sets --sidebar-w inline) counts as declared. Whatever replaced --nav-row-h keeps 40px in the comfortable density.
// - "a ponte acabou" (CA-6) stays a todo after F4: the brand session keeps --fs-2xl (22px, outside the scale) in the
//   bridge until the titles that read it move to the scale in their BRDs (BRD-05, BRD-06...). T18's ratchet (the bridge
//   keeps only --fs-2xl) is tests/unit/token-generator.test.ts. The bridge is read only when it exists.
// The CSS files are the product here, so reading them as text is the behaviour under test, not a source-text proxy
// (allowed). Not covered here: CA-3 (+1 kB raw CSS per lot against main) is the CI [bundle] line; colors and sizes on
// screen are the desktop visual goldens and the phone Paparazzi goldens, which stay unchanged (CA-4 end to end).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'
import { RETIRED_TOKEN_NAMES } from '../../src/design/tokens/retired'
import { LAYER } from '../../src/design/tokens/scales'
import { tokensCss } from '../../src/design/tokens/css'

const root = process.cwd()
const BRIDGE = 'src/styles/tokens.css'
const bridgePath = join(root, BRIDGE)
const bridge = existsSync(bridgePath) ? readFileSync(bridgePath, 'utf8') : ''

type Kind = 'alias' | 'literal' | 'compound'
const NAMES = (JSON.parse(readFileSync(join(root, 'tests/fixtures/token-bridge-snapshot.json'), 'utf8')) as {
  names: Record<string, { declared: string; generated: string[]; kind: Kind }>
}).names

/** The last lot (T18): the families whose longer generated names would grow the CSS (OXE-137/Q-10). */
const LAST_LOT = new Set(['fs', 'tx', 'bd', 'dot'])
const familyOf = (name: string): string => name.slice(2).split('-')[0]
/** After T17: the 23 declarations of --fs, --tx, --bd and --dot on main. Lower it as lots land; never raise it. */
const BRIDGE_CAP = 23

interface Declaration { file: string; selector: string; name: string; value: string }

/** Custom property declarations, each with the chain of rule and at-rule preludes around it as its selector. */
function declarationsIn(css: string, file: string): Declaration[] {
  const out: Declaration[] = []
  const stack: string[] = []
  let buffer = ''
  const collect = (chunk: string): void => {
    const found = /^\s*(--[\w-]+)\s*:\s*([\s\S]+)$/.exec(chunk)
    if (found) out.push({ file, selector: stack.join(' '), name: found[1], value: found[2].trim() })
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

const GENERATED_FILE = 'src/styles/tokens.generated.css'
const SOURCES = walk(join(root, 'src')).filter(path => path !== BRIDGE && path !== GENERATED_FILE)
const TEXT = new Map(SOURCES.map(path => [path, readFileSync(join(root, path), 'utf8')]))
const generated = declarationsIn(tokensCss(), 'tokensCss()')
const generatedNames = new Set(generated.map(item => item.name))
const local = SOURCES.filter(path => path.endsWith('.css')).flatMap(path => declarationsIn(TEXT.get(path)!, path))
/** Custom properties a component sets from TS: an inline style key, or setProperty. */
const inline = new Set(SOURCES.filter(path => !path.endsWith('.css'))
  .flatMap(path => [...TEXT.get(path)!.matchAll(/['"`](--[\w-]+)['"`](?:\s+as\s+\w+)?\s*\]?\s*[:,]/g)].map(found => found[1])))
const bridgeDeclarations = declarationsIn(bridge, BRIDGE)

function readers(name: string): string[] {
  const pattern = new RegExp(`var\\(\\s*${name}(?![\\w-])`)
  return SOURCES.filter(path => pattern.test(TEXT.get(path)!))
}

const normal = (value: string): string => value.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim()

describe('token bridge', () => {
  test('catraca só desce: the bridge keeps only the last lot, under the cap, and no retired name comes back (OXE-137 CA-1, CA-5)', () => {
    expect(bridgeDeclarations.length, 'declarations left in the bridge').toBeLessThanOrEqual(BRIDGE_CAP)
    for (const declaration of bridgeDeclarations) {
      expect(Object.keys(NAMES), `${declaration.name} is a new bridge name`).toContain(declaration.name)
      expect(LAST_LOT.has(familyOf(declaration.name)), `${declaration.name} belongs to a lot that already left the bridge`).toBe(true)
    }
    for (const retired of ['--sh-border', '--sh-accent', '--brand-glow', '--badge-bg', '--tile-header-h', '--wb-sidebar']) {
      expect(bridge, retired).not.toMatch(new RegExp(`${retired}:`))
    }
  })

  test('nenhum valor muda: each name that left the bridge resolves to the same token, or to the same declared value (OXE-137 CA-4, CA-5)', async () => {
    const left = Object.keys(NAMES).filter(name => !bridgeDeclarations.some(item => item.name === name))
    expect(left.length, 'names that left the bridge').toBeGreaterThan(0)
    const path = '../../src/design/tokens/retired'
    const { RETIRED_TOKEN_NAMES: retired } = (await import(/* @vite-ignore */ path)) as { RETIRED_TOKEN_NAMES: Readonly<Record<string, string>> }
    expect(retired).toBeTypeOf('object')

    /** A generated name, followed through the renames the generator made (T18). */
    const token = (name: string): string => {
      let current = name
      for (let hops = 0; hops < 8 && !generatedNames.has(current) && retired[current]?.startsWith('--'); hops++) current = retired[current]
      return current
    }
    /** A value with each var() of a snapshot name as that name's snapshot value, and each generated name renamed. */
    const canonical = (value: string, depth = 0): string => normal(value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (match, name: string) => {
      if (depth > 8) return match
      const entry = NAMES[name]
      if (entry) return entry.kind === 'alias' ? `var(${token(entry.generated[0])})` : canonical(entry.declared, depth + 1)
      const replacement = retired[name]
      if (replacement !== undefined && !generatedNames.has(name)) return canonical(replacement.startsWith('--') ? `var(${replacement})` : replacement, depth + 1)
      return `var(${name})`
    }))
    const declaredValues = (name: string): Declaration[] => [...generated, ...local].filter(item => item.name === name && !/data-density|prefers-contrast/.test(item.selector))

    for (const name of left) {
      const entry = NAMES[name]
      const still = declaredValues(name)
      if (still.length > 0) {
        for (const item of still) {
          if (entry.kind !== 'alias') expect(canonical(item.value), `${name} in ${item.file}`).toBe(canonical(entry.declared))
          else if (item.file === 'tokensCss()') expect(token(entry.generated[0]), `${name} is now generated, in place of ${entry.generated[0]}`).toBe(name)
          else expect(canonical(item.value), `${name} in ${item.file}`).toBe(`var(${token(entry.generated[0])})`)
        }
        continue
      }
      if (inline.has(name)) continue
      expect(readers(name), `${name} is read but declared nowhere any more`).toEqual([])
      const replacement = retired[name]
      expect(replacement, `${name} left the bridge without a RETIRED_TOKEN_NAMES entry`).toBeTypeOf('string')
      if (entry.kind === 'alias') {
        expect(token(replacement), `${name} must resolve to the token the snapshot names`).toBe(token(entry.generated[0]))
        expect(generatedNames.has(token(replacement)), `${token(replacement)} is not a generated token`).toBe(true)
        continue
      }
      const expected = canonical(entry.declared)
      if (!replacement.startsWith('--')) { expect(canonical(replacement), `${name} became the value itself`).toBe(expected); continue }
      const values = declaredValues(replacement)
      expect(values.length, `${replacement} (in place of ${name}) is declared nowhere`).toBeGreaterThan(0)
      for (const item of values) expect(canonical(item.value), `${replacement} in ${item.file}, in place of ${name}`).toBe(expected)
    }

    // The comfortable density keeps its own row height (40px) for whatever --nav-row-h became.
    if (!bridgeDeclarations.some(item => item.name === '--nav-row-h')) {
      const row = declaredValues('--nav-row-h').length > 0 ? '--nav-row-h' : retired['--nav-row-h']
      if (row?.startsWith('--')) {
        const comfortable = [...generated, ...local].filter(item => item.name === row && /data-density=['"]?comfortable/.test(item.selector))
        expect(comfortable.map(item => normal(item.value)), `${row} under the comfortable density`).toContain('40px')
      }
    }
  })

  test.todo('a ponte acabou: the bridge file is gone and nothing in src/ reads a name only it declared (OXE-137 CA-6; after --fs-2xl leaves with its BRDs)')

  test('a legacy color name still in the bridge follows a semantic token, not a literal', () => {
    for (const name of ['bg-app', 'bg-elevated', 'tx-primary', 'tx-muted', 'wb-border']) {
      const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(bridge)?.[1]?.trim()
      // OXE-137 retires a plain alias from the bridge: its readers now name the generated token, recorded in retired.ts.
      if (value === undefined && RETIRED_TOKEN_NAMES[`--${name}`]) { expect(RETIRED_TOKEN_NAMES[`--${name}`], name).toMatch(/^--/); continue }
      if (value === undefined) continue
      expect(value, name).toMatch(/^var\(--/)
    }
    expect(bridge).not.toMatch(/--accent-hover:/)
  })

  test('dialog surfaces sit above the modal scrim', () => {
    // Radix renders the scrim and the content as siblings in the portal, so a
    // surface below the scrim's layer renders dimmed and unclickable. jsdom does
    // not resolve stacking, so compare the declared values.
    const scrimZ = LAYER.overlay
    const overlay = readFileSync(join(process.cwd(), 'src/ui/Overlay.module.css'), 'utf8')
    const components = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8')
    for (const [selector, source] of [['.dialog', overlay], ['.modal-dialog-surface', components]] as const) {
      const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? ''
      const declared = /z-index:\s*(?:var\(--layer-(\w+)\)|(\d+))/.exec(block)
      const zIndex = declared?.[1] ? LAYER[declared[1] as keyof typeof LAYER] : Number(declared?.[2])
      expect(zIndex, `${selector} must declare a z-index`).toBeGreaterThan(0)
      expect(zIndex, `${selector} sits under the scrim`).toBeGreaterThanOrEqual(scrimZ)
    }
  })
})
