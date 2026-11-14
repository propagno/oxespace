import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as icons from '../src/ui/icons'
import { SIGNAL_STATES, StatusSignal } from '../src/ui/StatusSignal'

/** OXE-49 M3: the own icons and the seven state signals of Mandacaru Noite (docs/design/brand.md). */
const ICONS = Object.entries(icons).filter(([name]) => /^[A-Z]\w*Icon$/.test(name)) as [string, icons.OxeIcon][]

describe('own icons', () => {
  it('ships the twelve approved concepts, each in its own module', () => {
    expect(ICONS.map(([, icon]) => icon.iconName).sort()).toEqual(
      ['agent', 'agents', 'approval', 'changes', 'checkpoint', 'conversation', 'database', 'delegate', 'needs-you', 'pull-request', 'terminal', 'worktree'])
    const barrel = readFileSync(join(__dirname, '../src/ui/icons/index.ts'), 'utf8')
    for (const [name] of ICONS) expect(barrel).toContain(`export { ${name} } from './${name}'`)
  })

  it.each(ICONS)('%s draws on the 16 grid with the Ramo stroke, in the text color, and is decorative unless labelled', (_name, Icon) => {
    const { container, rerender } = render(<Icon />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg.getAttribute('width')).toBe('16')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('stroke-width')).toBe('1.75')
    expect(svg.getAttribute('stroke-linecap')).toBe('round')
    expect(svg.getAttribute('stroke-linejoin')).toBe('round')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.querySelectorAll('path, rect, circle, ellipse').length).toBeGreaterThan(0)
    rerender(<Icon size={24} label="Open terminal" />)
    expect(screen.getByRole('img', { name: 'Open terminal' }).getAttribute('width')).toBe('24')
  })
})

describe('state signals', () => {
  it('has exactly the seven approved states', () => {
    expect([...SIGNAL_STATES]).toEqual(['needs-you', 'working', 'failed', 'done', 'waiting', 'interrupted', 'unconfirmed'])
  })

  it.each([...SIGNAL_STATES])('%s is a labelled image with its own shape', state => {
    const { container } = render(<StatusSignal state={state} label={`State: ${state}`} />)
    const signal = screen.getByRole('img', { name: `State: ${state}` })
    expect(signal).toHaveAttribute('data-ui', 'status-signal')
    expect(signal).toHaveAttribute('data-state', state)
    expect(container.querySelector('title')?.textContent).toBe(`State: ${state}`)
  })

  it('tells the states apart by shape, not only by color', () => {
    const shape = (state: (typeof SIGNAL_STATES)[number]): string => {
      const { container, unmount } = render(<StatusSignal state={state} label={state} />)
      const markup = [...container.querySelectorAll('svg > *:not(title)')].map(node => `${node.tagName}:${['r', 'd', 'width'].map(a => node.getAttribute(a)).join(',')}`).join('|')
      unmount()
      return markup
    }
    const shapes = SIGNAL_STATES.map(shape)
    expect(new Set(shapes).size).toBe(SIGNAL_STATES.length)
  })

  it('colors come from tokens only: the sun for needs-you, the accent for working and done, danger for failed', () => {
    const css = readFileSync(join(__dirname, '../src/ui/StatusSignal.module.css'), 'utf8')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css).toMatch(/\.needs-you\s*\{\s*color:\s*var\(--attn\)/)
    expect(css).toMatch(/\.working\s*\{\s*color:\s*var\(--accent\)/)
    expect(css).toMatch(/\.done\s*\{\s*color:\s*var\(--accent\)/)
    expect(css).toMatch(/\.failed\s*\{\s*color:\s*var\(--intent-danger-solid\)/)
    // Only the needs-you signal may use the sun.
    expect(css.match(/var\(--attn/g)).toHaveLength(1)
  })
})
