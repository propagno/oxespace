import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DesignSystemPage } from '../../src/components/DesignSystem/DesignSystemPage'

const ROOT = join(__dirname, '..', '..')
const readCss = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.surface
})

describe('OXE-460 · Obsidian Minimal + Mandacaru primitives', () => {
  it('toggles Surface style between Default and Pure in DesignSystemPage and showcases Surface presets and PaneHeader', () => {
    render(<DesignSystemPage onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'Design system' })
    expect(dialog).toHaveAttribute('data-surface', 'default')

    const lightCols = dialog.querySelectorAll('[data-mode="light"][data-surface="default"]')
    const darkCols = dialog.querySelectorAll('[data-mode="dark"][data-surface="default"]')
    expect(lightCols.length).toBeGreaterThan(0)
    expect(darkCols.length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('radio', { name: 'Pure' }))
    expect(dialog).toHaveAttribute('data-surface', 'pure')
    expect(dialog.querySelectorAll('[data-mode="light"][data-surface="pure"]').length).toBeGreaterThan(0)
    expect(dialog.querySelectorAll('[data-mode="dark"][data-surface="pure"]').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Surface presets (Default vs Pure)' })).toBeInTheDocument()
    expect(screen.getByText('Dark · Pure')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '1.5.2 Primitives' }))
    expect(dialog.querySelectorAll('[data-ui="pane-header"][data-focused="true"]').length).toBeGreaterThan(0)
  })

  it('applies Obsidian Minimal hairline borders, quiet chrome, and Mandacaru cues across src/ui CSS modules', () => {
    const button = readCss('src/ui/Button.module.css')
    expect(button).toMatch(/\[data-variant='secondary'\][^{]*\{[^}]*background:\s*transparent/)
    expect(button).toMatch(/\[data-variant='secondary'\][^{]*\{[^}]*border-color:\s*var\(--bd-control\)/)

    const card = readCss('src/ui/Card.module.css')
    expect(card).toMatch(/\.card\s*\{[^}]*border:\s*1px solid var\(--bd-subtle\)/)
    expect(card).toMatch(/\.card\s*\{[^}]*box-shadow:\s*none/)

    const field = readCss('src/ui/Field.module.css')
    expect(field).toMatch(/\.kbd\s*\{[^}]*border:\s*1px solid var\(--bd-subtle\)/)
    expect(field).toMatch(/\.kbd\s*\{[^}]*background:\s*var\(--surface-sunken\)/)
    expect(field).not.toMatch(/\.kbd\s*\{[^}]*border-bottom-width:\s*2px/)

    const paneHeader = readCss('src/ui/PaneHeader.module.css')
    expect(paneHeader).toMatch(/\.focused\s*\{[^}]*background:\s*var\(--surface-raised\)/)
    expect(paneHeader).toMatch(/\.focused\s*\{[^}]*var\(--accent\)/)

    const splitter = readCss('src/ui/Splitter.module.css')
    expect(splitter).toMatch(/\.splitter\s*\{[^}]*background:\s*var\(--bd-subtle\)/)

    const sidebar = readCss('src/ui/Sidebar.module.css')
    expect(sidebar).toMatch(/\.item\.selected::before\s*\{[^}]*background:\s*var\(--accent\)/)
  })
})
