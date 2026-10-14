import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { LAYER } from '../../src/design/tokens/scales'

/**
 * The compatibility bridge in tokens.css maps names the legacy stylesheets
 * still use onto the generated design tokens. A literal there would stop
 * following light and dark mode without any rendering test noticing.
 */
const bridge = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')

describe('token bridge', () => {
  test('every remaining shadcn-era name indirects through a design token', () => {
    const names = [...bridge.matchAll(/--sh-([a-z-]+):\s*([^;]+);/g)]
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter(([, , value]) => !value.trim().startsWith('var(')).map(([, name]) => name)).toEqual([])
  })

  test('legacy color names follow the semantic tokens, not literals', () => {
    for (const name of ['bg-app', 'bg-elevated', 'tx-primary', 'tx-muted', 'wb-border', 'accent-hover']) {
      const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(bridge)?.[1]?.trim()
      if (name === 'accent-hover') { expect(value).toBeUndefined(); continue }
      expect(value, name).toMatch(/^var\(--/)
    }
  })

  test('dialog surfaces sit above the modal scrim', () => {
    // Radix renders the scrim and the content as siblings in the portal, so a
    // surface below the scrim's layer renders dimmed and unclickable. jsdom does
    // not resolve stacking, so compare the declared values.
    const scrimZ = LAYER.overlay
    const layout = readFileSync(join(process.cwd(), 'src/styles/layout.css'), 'utf8')
    const components = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8')
    for (const [selector, source] of [['.tools-modal', layout], ['.modal-dialog-surface', components]] as const) {
      const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? ''
      const zIndex = Number(/z-index:\s*(\d+)/.exec(block)?.[1])
      expect(zIndex, `${selector} must declare a z-index`).toBeGreaterThan(0)
      expect(zIndex, `${selector} sits under the scrim`).toBeGreaterThanOrEqual(scrimZ)
    }
  })
})
