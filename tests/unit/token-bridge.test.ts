import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * F1 token bridge: shadcn's semantic tokens must resolve to OXESpace's brand
 * palette, not shadcn's stock neutral grays. Re-running `npx shadcn add` (or
 * copying a fresh primitive) rewrites these blocks with the defaults, which
 * would silently turn every migrated panel gray while the legacy panels stay
 * branded — a regression no rendering test would catch.
 */
const uiKit = readFileSync(join(process.cwd(), 'src/styles/ui-kit.css'), 'utf8')

/** The `--sh-*` custom properties declared in the bridge block. */
function bridgedValue(token: string): string | undefined {
  return new RegExp(`--sh-${token}:\\s*([^;]+);`).exec(uiKit)?.[1]?.trim()
}

describe('shadcn token bridge', () => {
  test('every bridged token indirects through an OXESpace token', () => {
    // Direct color literals here mean a primitive stopped following the theme.
    const bridged = [...uiKit.matchAll(/--sh-([a-z-]+):\s*([^;]+);/g)]
    expect(bridged.length).toBeGreaterThan(20)

    const literals = bridged.filter(([, , value]) => !value.trim().startsWith('var('))
    // destructive-foreground is deliberately pure white — it sits on red in
    // every theme, and no OXESpace token expresses "text on a danger fill".
    expect(literals.map(([, name]) => name)).toEqual(['destructive-foreground'])
  })

  test('interactive tokens track the themeable --accent, not the fixed --brand', () => {
    // The 11 [data-theme] palettes retheme --accent but never --brand, so
    // binding primary/ring to --brand would leave emerald buttons in a nord UI.
    expect(bridgedValue('primary')).toBe('var(--accent)')
    expect(bridgedValue('ring')).toBe('var(--accent)')
  })

  test('primary foreground stays dark-on-accent so it reads in every theme', () => {
    expect(bridgedValue('primary-foreground')).toBe('var(--bg-app)')
  })

  test('surfaces map onto the app chrome rather than shadcn grays', () => {
    expect(bridgedValue('background')).toBe('var(--bg-app)')
    expect(bridgedValue('card')).toBe('var(--bg-elevated)')
    expect(bridgedValue('foreground')).toBe('var(--tx-primary)')
    expect(bridgedValue('muted-foreground')).toBe('var(--tx-muted)')
    expect(bridgedValue('border')).toBe('var(--bd-subtle)')
  })

  test('dialog surfaces are not painted over by the modal overlay', () => {
    // Radix renders overlay and content as siblings in the portal, so a surface
    // whose z-index is below LEGACY_MODAL_OVERLAY's disappears behind the
    // blurred scrim — the whole panel renders blurred and unclickable. jsdom
    // does not resolve stacking, so assert the declared values instead.
    const dialogSource = readFileSync(join(process.cwd(), 'src/components/ui/dialog.tsx'), 'utf8')
    const overlayZ = Number(/LEGACY_MODAL_OVERLAY\s*=\s*'z-\[(\d+)\]/.exec(dialogSource)?.[1])
    expect(overlayZ).toBeGreaterThan(0)

    const layout = readFileSync(join(process.cwd(), 'src/styles/layout.css'), 'utf8')
    const components = readFileSync(join(process.cwd(), 'src/styles/components.css'), 'utf8')
    const surfaces: [string, string][] = [
      ['.tools-modal', layout],
      ['.modal-dialog-surface', components]
    ]

    for (const [selector, source] of surfaces) {
      const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? ''
      const zIndex = Number(/z-index:\s*(\d+)/.exec(block)?.[1])
      expect(zIndex, `${selector} must declare a z-index`).toBeGreaterThan(0)
      expect(zIndex, `${selector} sits under the overlay`).toBeGreaterThanOrEqual(overlayZ)
    }
  })

  test('@theme inline keeps shadcn colors out of :root', () => {
    // `inline` inlines values into utilities; dropping it would emit --color-*
    // and --accent into :root, colliding with OXESpace's own token names.
    expect(uiKit).toContain('@theme inline')
    expect(uiKit).toMatch(/--color-primary:\s*var\(--sh-primary\)/)
  })
})
