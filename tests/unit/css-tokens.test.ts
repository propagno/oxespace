import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Every `var(--x)` in the stylesheets must resolve to a custom property this
 * app actually defines.
 *
 * A reference to an undefined token is not a visible error — the whole
 * declaration is simply dropped. The Diagnostics panel shipped for weeks with
 * `--border-subtle`, `--surface-raised`, `--text-muted`, `--success`,
 * `--warning` and `--danger`, none of which exist here (the real names are
 * `--bd-subtle`, `--bg-elevated`, `--tx-muted`, `--dot-*`), so its cards
 * rendered with no border, no background and no status colour at all and just
 * looked badly designed. Three other panels had the same bug.
 */
const STYLES_DIR = join(process.cwd(), 'src/styles')

function readAllCss(): string {
  return readdirSync(STYLES_DIR)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(join(STYLES_DIR, name), 'utf8'))
    .join('\n')
}

/** Custom properties set from inline styles in components, e.g. tooltip geometry. */
function tokensSetFromComponents(): Set<string> {
  const found = new Set<string>()
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue
      for (const match of readFileSync(path, 'utf8').matchAll(/'(--[a-z0-9-]+)'\s*:/gi)) {
        found.add(match[1] as string)
      }
    }
  }
  walk(join(process.cwd(), 'src'))
  return found
}

describe('CSS custom properties', () => {
  const css = readAllCss()

  test('every referenced token is defined somewhere', () => {
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1] as string))

    const referenced = new Map<string, number>()
    // `var(--x)` only — `var(--x, fallback)` is a deliberate optional lookup.
    for (const match of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
      const token = match[1] as string
      referenced.set(token, (referenced.get(token) ?? 0) + 1)
    }
    expect(referenced.size).toBeGreaterThan(20)

    const fromComponents = tokensSetFromComponents()
    const undefinedTokens = [...referenced.entries()]
      .filter(([token]) => !defined.has(token))
      // Emitted by Tailwind's own layers, not declared in these files.
      .filter(([token]) => !token.startsWith('--tw-'))
      // Legitimately supplied at runtime via an inline style prop.
      .filter(([token]) => !fromComponents.has(token))
      .map(([token, count]) => `${token} (${count}x)`)

    expect(undefinedTokens, 'undefined tokens silently drop the whole declaration').toEqual([])
  })

  test('the tokens the diagnostics panel needs exist under their real names', () => {
    for (const token of ['--bd-subtle', '--bg-elevated', '--tx-muted', '--dot-green', '--dot-yellow', '--dot-red']) {
      expect(css, `${token} must stay defined`).toContain(`${token}:`)
    }
  })

  test('across all of src (CSS modules, feature stylesheets and inline styles), a token read with no fallback exists (OXE-118)', () => {
    // 18 reads like var(--surface-scrim), var(--layer-popover) and var(--intent-info) pointed at names that never
    // existed: the browser drops the declaration, so an overlay had no scrim, a popover no layer, a tool row no color.
    const SRC = join(process.cwd(), 'src')
    const sources: { path: string; text: string }[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/\.(css|tsx?)$/.test(entry.name)) sources.push({ path, text: readFileSync(path, 'utf8') })
      }
    }
    walk(SRC)
    const defined = new Set<string>()
    for (const { text } of sources) {
      for (const match of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(match[1] as string)
      // Set at runtime: style={{ '--x': … }}, setProperty('--x', …).
      for (const match of text.matchAll(/['"`](--[\w-]+)['"`]/g)) defined.add(match[1] as string)
    }
    const missing = sources.flatMap(({ path, text }) => [...text.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)]
      .map(match => match[1] as string)
      // Radix publishes these on its popper wrappers at runtime.
      .filter(token => !defined.has(token) && !token.startsWith('--radix-') && !token.startsWith('--tw-'))
      .map(token => `${path.slice(SRC.length + 1).split('\\').join('/')}: ${token}`))
    expect(missing, 'undefined tokens silently drop the whole declaration').toEqual([])
  })
})
