// Frozen acceptance test for OXE-362 A3, A4 (program 152p1b, phase F1). Written by the planner; the executor must not edit it.
// A finished text that cannot be drawn never shows the drawing of an earlier streaming frame; TIP is a GitHub alert.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

vi.mock('mermaid', () => ({
  default: {
    initialize: () => undefined,
    parse: async (code: string) => {
      if (code.includes('BROKEN')) throw new Error('Parse error')
      return { diagramType: 'flowchart-v2' }
    },
    render: async (id: string, code: string) => {
      if (code.includes('BROKEN')) throw new Error('Parse error')
      return { svg: `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"><text>FRAME</text></svg>` }
    }
  }
}))

import { MermaidDiagram } from '../../../src/components/Threads/ThreadMermaid'
import { ThreadMarkdown } from '../../../src/components/Threads/ThreadMarkdown'

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('OXE-362 · rich answer', () => {
  it('an invalid final diagram replaces the streamed frame with the failure and its code', async () => {
    const view = render(<MermaidDiagram code={'flowchart LR\n  A --> B'} streaming />)
    await waitFor(() => expect(view.container.querySelector('svg text')?.textContent).toBe('FRAME'), { timeout: 5_000 })
    view.rerender(<MermaidDiagram code={'flowchart LR\n  A --> BROKEN['} />)
    expect(await screen.findByRole('note', {}, { timeout: 5_000 })).toBeInTheDocument()
    expect(view.container.textContent).toContain('BROKEN[')
    expect(view.container.querySelector('svg text')).toBeNull()
  }, 20_000)

  it('a TIP quote is an alert in both languages', async () => {
    for (const [language, label] of [['en', 'Tip'], ['pt-BR', 'Dica']] as const) {
      await changeLanguage(language)
      const view = render(<ThreadMarkdown text={'> [!TIP]\n> Use the cache.'} />)
      const alert = await waitFor(() => {
        const found = view.container.querySelector('[data-ui="alert"][data-kind="tip"]')
        expect(found).not.toBeNull()
        return found as HTMLElement
      })
      expect(alert).toHaveTextContent(label)
      expect(alert).not.toHaveTextContent('[!TIP]')
      view.unmount()
    }
  })

  // rigor: source-assertion — jsdom has no layout; the criterion is the stylesheet's rules.
  it('wide diagrams keep their left edge and enlarge does not stretch small ones', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/Threads/ThreadMarkdown.css'), 'utf8')
    expect(css).toMatch(/\.thread-diagram\s*\{[^}]*justify-content:\s*safe center/)
    const enlarged = /\.thread-diagram-enlarged svg\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(enlarged).toMatch(/(^|[;\s])width:\s*auto/)
    expect(enlarged).toMatch(/max-width:\s*100%/)
    expect(enlarged).toMatch(/(^|[;\s])height:\s*auto/)
  })
})
