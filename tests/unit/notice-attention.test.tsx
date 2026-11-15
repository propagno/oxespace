// OXE-109 (brand review of #823): "needs you" is the sun ochre, not a warning. The ui Notice's attention intent is a
// neutral card with the signal only in its header, a polite status named by its request, said once per request.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Notice } from '../../src/ui'

afterEach(() => { cleanup() })

/** One CSS rule's declarations from the Notice stylesheet. */
function rule(selector: string): string {
  const css = readFileSync(join(process.cwd(), 'src/ui/Display.module.css'), 'utf8')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n|,\\s*)${escaped}\\s*(?:,[^{]*)?\\{([^}]*)\\}`))
  return match?.[1] ?? ''
}

describe('Notice · attention intent', () => {
  it('is a polite status named by its request, never an alert', () => {
    render(<Notice intent="attention" label="An agent asks to open https://example.com in the Browser" title="An agent asks">body</Notice>)
    const card = screen.getByRole('status', { name: 'An agent asks to open https://example.com in the Browser' })
    expect(card).toHaveAttribute('data-intent', 'attention')
    expect(card).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('paints a neutral card with the sun ochre only in its header (icon and title), not the warning orange', () => {
    // rigor: source-assertion — jsdom computes no CSS-module custom properties; the contrast of --attn-fg on
    // --surface-raised (≥ 4.5:1) is proven on the real tokens by tests/design-tokens.test.ts.
    const card = rule('.noticeAttention')
    expect(card).toMatch(/background:\s*var\(--surface-raised\)/)
    expect(card).toMatch(/border-color:\s*var\(--attn-border\)/)
    expect(card).not.toMatch(/intent-warning|--attn-bg/)
    expect(rule('.noticeAttention .noticeIcon')).toMatch(/color:\s*var\(--attn-fg\)/)
    expect(rule('.noticeAttention .noticeTitle')).toMatch(/color:\s*var\(--attn-fg\)/)
    // The header is the icon and the title; the body and the actions stay in the card's own text colour.
    expect(readFileSync(join(process.cwd(), 'src/ui/Display.tsx'), 'utf8')).toMatch(/<strong className=\{styles\.noticeTitle\}>/)
    render(<Notice intent="attention" title="Needs you">body</Notice>)
    expect(screen.getByText('Needs you').tagName).toBe('STRONG')
  })

  it('is said once per request: a re-render or a remount of the same request is not announced again', () => {
    const first = render(<Notice intent="attention" label="Request A" announceKey="oxe109-a:1" actions={<button type="button">Allow once</button>}>A</Notice>)
    expect(screen.getByRole('status', { name: 'Request A' })).toHaveAttribute('aria-live', 'polite')
    // A re-render (the store went busy, say) keeps the same region and the same words.
    const region = screen.getByRole('status', { name: 'Request A' })
    first.rerender(<Notice intent="attention" label="Request A" announceKey="oxe109-a:1" actions={<button type="button" disabled>Allow once</button>}>A</Notice>)
    expect(screen.getByRole('status', { name: 'Request A' })).toBe(region)
    expect(region).toHaveTextContent('A')
    first.unmount()
    // The panel shows the same request again: still a status, but silent.
    render(<Notice intent="attention" label="Request A" announceKey="oxe109-a:1">A</Notice>)
    expect(screen.getByRole('status', { name: 'Request A' })).toHaveAttribute('aria-live', 'off')
    cleanup()
    // A new generation of the request, or another request, is said.
    render(<Notice intent="attention" label="Request A again" announceKey="oxe109-a:2">A</Notice>)
    expect(screen.getByRole('status', { name: 'Request A again' })).toHaveAttribute('aria-live', 'polite')
  })

  it('leaves the other intents as they were', () => {
    const { rerender } = render(<Notice intent="warning" title="2 worktrees have changes">Removing them discards them.</Notice>)
    expect(screen.getByRole('alert')).not.toHaveAttribute('aria-live')
    rerender(<Notice intent="danger">Could not apply the policy.</Notice>)
    expect(screen.getByRole('alert')).toHaveAttribute('data-intent', 'danger')
    rerender(<Notice intent="info">Agents use your shell profile.</Notice>)
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-live')
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-label')
    rerender(<Notice intent="success">Saved.</Notice>)
    expect(screen.getByRole('status')).toHaveAttribute('data-intent', 'success')
  })
})
