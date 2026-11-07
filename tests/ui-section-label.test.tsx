import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SectionLabel } from '../src/ui/SectionLabel'

/** U3 (X2, D-03): a small label over a group, in sentence case as written. */
afterEach(cleanup)

describe('SectionLabel', () => {
  it('shows its words as written, as a heading when asked, with an action at the end of the line', () => {
    render(<SectionLabel as="h3" id="conn" actions={<button type="button">Add</button>}>Connections</SectionLabel>)
    expect(screen.getByRole('heading', { level: 3, name: 'Connections' })).toHaveAttribute('id', 'conn')
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('is never uppercased by its styles', () => {
    const css = readFileSync(join(__dirname, '..', 'src', 'ui', 'SectionLabel.module.css'), 'utf8')
    expect(css).not.toMatch(/text-transform/)
    expect(css).toMatch(/font-size: var\(--text-xs\)/)
    expect(css).toMatch(/color: var\(--text-secondary\)/)
  })
})
