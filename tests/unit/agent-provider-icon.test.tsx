import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { ALL_PROVIDERS, type AgentProvider } from '../../shared/types/agent'
import { AgentProviderIcon } from '../../src/components/Sidebar/AgentProviderIcon'

afterEach(cleanup)

function svgSignature(provider: AgentProvider): string {
  const { container, unmount } = render(<AgentProviderIcon provider={provider} size={20} />)
  const svg = container.querySelector('svg')
  expect(svg, `${provider} renders an SVG`).not.toBeNull()
  const parts = [...svg!.querySelectorAll('path, rect, circle, line, polygon')].map(el =>
    `${el.tagName}:${el.getAttribute('d') ?? ''}:${el.getAttribute('x') ?? ''}:${el.getAttribute('r') ?? ''}`
  )
  unmount()
  return parts.join('|')
}

describe('OXE-437 · AgentProviderIcon official provider SVG marks', () => {
  test('renders every known provider with .agent-provider-icon, aria-hidden, and an SVG mark', () => {
    expect(ALL_PROVIDERS).toHaveLength(8)
    for (const provider of ALL_PROVIDERS) {
      const { container, unmount } = render(<AgentProviderIcon provider={provider} />)
      const root = container.querySelector('.agent-provider-icon') as HTMLElement | null
      expect(root, `${provider} root element`).not.toBeNull()
      expect(root?.getAttribute('aria-hidden')).toBe('true')
      expect(root?.getAttribute('data-provider')).toBe(provider)
      const svg = root?.querySelector('svg')
      expect(svg, `${provider} svg`).not.toBeNull()
      expect(svg?.querySelectorAll('path, rect, circle, line').length).toBeGreaterThan(0)
      unmount()
    }
  })

  test('renders distinct official SVG marks for each provider brand (and shares Copilot mark for gh-copilot)', () => {
    const distinctProviders: AgentProvider[] = ['antigravity', 'claude', 'codex', 'cursor', 'copilot', 'grok', 'custom']
    const signatures = new Map(distinctProviders.map(provider => [provider, svgSignature(provider)]))

    expect(new Set(signatures.values()).size).toBe(distinctProviders.length)
    expect(svgSignature('gh-copilot')).toBe(signatures.get('copilot'))
  })

  test('uses official brand marks rather than generic lucide placeholders for non-custom providers', () => {
    const branded: AgentProvider[] = ['antigravity', 'claude', 'codex', 'cursor', 'copilot', 'gh-copilot', 'grok']
    for (const provider of branded) {
      const { container, unmount } = render(<AgentProviderIcon provider={provider} />)
      const svg = container.querySelector('svg')!
      expect(svg.classList.contains('lucide'), `${provider} must not render a lucide placeholder`).toBe(false)
      unmount()
    }

    const { container } = render(<AgentProviderIcon provider="custom" />)
    expect(container.querySelector('svg')?.classList.contains('lucide-bot')).toBe(true)
  })

  test('antigravity generates unique gradient IDs across simultaneous mounts without DOM collisions', () => {
    const { container } = render(
      <div>
        <AgentProviderIcon provider="antigravity" size={14} />
        <AgentProviderIcon provider="antigravity" size={20} />
        <AgentProviderIcon provider="antigravity" size={28} />
      </div>
    )

    const icons = container.querySelectorAll('.agent-provider-icon[data-provider="antigravity"]')
    expect(icons).toHaveLength(3)

    const allIds: string[] = []
    for (const icon of icons) {
      const gradients = [...icon.querySelectorAll('linearGradient, radialGradient')]
      expect(gradients.length).toBeGreaterThanOrEqual(2)
      const ids = gradients.map(node => node.getAttribute('id') ?? '')
      expect(ids.every(id => id.length > 0)).toBe(true)

      // Every gradient fill referenced on a path resolves to an ID defined in the same SVG.
      const fillRefs = [...icon.querySelectorAll('path')]
        .map(path => path.getAttribute('fill') ?? '')
        .map(fill => /^url\(#([^)]+)\)$/.exec(fill)?.[1])
        .filter((id): id is string => Boolean(id))
      expect(fillRefs.length).toBeGreaterThanOrEqual(2)
      for (const ref of fillRefs) expect(ids).toContain(ref)

      allIds.push(...ids)
    }

    expect(new Set(allIds).size).toBe(allIds.length)
  })

  test('scales the inner SVG proportionally to size across 14px, 16px, 20px, and 28px', () => {
    const sizes = [14, 16, 20, 28] as const
    const renderedGlyphWidths: number[] = []

    for (const size of sizes) {
      const { container, unmount } = render(<AgentProviderIcon provider="claude" size={size} />)
      const root = container.querySelector('.agent-provider-icon') as HTMLElement
      const svg = root.querySelector('svg')!
      const expectedGlyph = Math.max(8, Math.round(size * 0.72))

      expect(root.style.width).toBe(`${size}px`)
      expect(root.style.height).toBe(`${size}px`)
      expect(Number(svg.getAttribute('width'))).toBe(expectedGlyph)
      expect(Number(svg.getAttribute('height'))).toBe(expectedGlyph)
      renderedGlyphWidths.push(expectedGlyph)
      unmount()
    }

    // Strictly monotonic scaling — not stuck at a hardcoded 12px icon inside a 28px badge.
    for (let i = 1; i < renderedGlyphWidths.length; i++) {
      expect(renderedGlyphWidths[i]).toBeGreaterThan(renderedGlyphWidths[i - 1])
    }
    expect(renderedGlyphWidths.at(-1)).toBeGreaterThan(16)
  })

  test('falls back cleanly to custom badge and Bot icon for an unknown provider value', () => {
    const { container } = render(<AgentProviderIcon provider={'unknown' as AgentProvider} size={20} />)
    const root = container.querySelector('.agent-provider-icon') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.style.backgroundColor).toBe('var(--provider-custom)')
    expect(root.querySelector('svg')?.classList.contains('lucide-bot')).toBe(true)
  })
})
