// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../src/i18n'

// The diagram library measures text in a real page, which jsdom is not: a stand-in that reads the same way.
const parse = vi.fn(async (code: string) => /^(graph|flowchart|sequenceDiagram)\b/.test(code.trim()) && !/-->\s*$/.test(code.trim()))
const renderDiagram = vi.fn(async (id: string, code: string) => ({ svg: `<svg id="${id}" viewBox="0 0 10 10"><style>#${id}{fill:red}</style><g><text>${code.includes('Login') ? 'Login' : 'node'}</text></g><script>window.hacked = true</script><foreignObject><img src="x" onerror="window.hacked = true"></foreignObject></svg>` }))
const initialize = vi.fn()
vi.mock('mermaid', () => ({ default: { initialize, parse, render: renderDiagram } }))

import { ThreadMarkdown } from '../src/components/Threads/ThreadMarkdown'

afterEach(() => { cleanup(); delete (window as { hacked?: boolean }).hacked })

describe('formulas in an answer', () => {
  test('an inline formula is drawn, and the letters around it keep their Markdown', async () => {
    const { container } = render(<ThreadMarkdown text={'The **sum** $a_1 + b_2$ holds, and `code` stays code.'} />)
    const formula = await screen.findByTestId('thread-math')
    expect(formula.getAttribute('aria-label')).toBe('a_1 + b_2')
    expect(formula.querySelector('.katex')).not.toBeNull()
    // The underscores were never read as italics, and the mark that carried the formula is nowhere on the page.
    expect(container.querySelector('em')).toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('sum')
    expect(container.textContent).not.toContain('⁣')
    expect([...container.querySelectorAll('code')].map(code => code.textContent)).toContain('code')
  })

  test('a displayed formula is drawn as a block, from $$ … $$ and from a fenced block named math', async () => {
    render(<ThreadMarkdown text={'Energy:\n\n$$\nE = mc^2\n$$\n\nAnd:\n\n```math\n\\int_0^1 x\\,dx\n```'} />)
    await waitFor(() => expect(screen.getAllByTestId('thread-math-block')).toHaveLength(2))
    expect(screen.getAllByTestId('thread-math-block').map(node => node.getAttribute('aria-label'))).toEqual(['E = mc^2', '\\int_0^1 x\\,dx'])
  })

  test('TeX the library cannot read shows as its source, with no error on the page', async () => {
    const { container } = render(<ThreadMarkdown text={'Broken $\\frac{a}{$ here.'} />)
    await waitFor(() => expect(container.querySelector('.thread-math-source')?.textContent).toBe('\\frac{a}{'))
    expect(container.querySelector('.katex-error')).toBeNull()
    expect(screen.queryByTestId('thread-math')).toBeNull()
  })

  test('a formula cannot carry a link, an image or markup onto the page', async () => {
    const { container } = render(<ThreadMarkdown text={'$\\href{javascript:alert(1)}{x}$ and $\\includegraphics{https://example.com/p.png}$ and $\\text{<img src=x onerror=alert(1)>}$'} />)
    await waitFor(() => expect(container.querySelectorAll('.thread-math, .thread-math-source').length).toBe(3))
    // What the TeX says is on the page only as words (its label, its letters): no element that links, loads or runs.
    expect(container.querySelector('a, img, script, iframe, object, embed, form')).toBeNull()
    const risky = [...container.querySelectorAll('*')].flatMap(node => [...node.attributes].filter(attribute => /^on/i.test(attribute.name) || (/^(href|src|xlink:href|action)$/i.test(attribute.name))).map(attribute => `${node.tagName} ${attribute.name}`))
    expect(risky).toEqual([])
  })

  test('money and code are left as they were', () => {
    const { container } = render(<ThreadMarkdown text={'From $5 to $10. Run `echo $a$b`.'} />)
    expect(container.textContent).toBe('From $5 to $10. Run echo $a$b.')
    expect(container.querySelector('.thread-math, .thread-math-source')).toBeNull()
  })
})

describe('diagrams in an answer', () => {
  test('a fenced block named mermaid is drawn; scripts and markup in what the library wrote never reach the page', async () => {
    const { container } = render(<ThreadMarkdown text={'Flow:\n\n```mermaid\ngraph TD\n  A[Login] --> B[Home]\n```'} />)
    const block = await screen.findByTestId('thread-diagram')
    await waitFor(() => expect(block.querySelector('.thread-diagram svg')).not.toBeNull())
    expect(block.querySelector('.thread-diagram')?.textContent).toContain('Login')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toMatch(/onerror|<img/i)
    expect((window as { hacked?: boolean }).hacked).toBeUndefined()
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ securityLevel: 'strict', htmlLabels: false, startOnLoad: false }))
  })

  test('the code is one click away, and Copy copies the code', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ThreadMarkdown text={'```mermaid\ngraph TD\n  A[Login] --> B[Home]\n```'} />)
    const block = await screen.findByTestId('thread-diagram')
    await waitFor(() => expect(block.querySelector('.thread-diagram svg')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Show code' }))
    expect(block.querySelector('pre code')?.textContent).toBe('graph TD\n  A[Login] --> B[Home]')
    expect(block.querySelector('.thread-diagram')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show diagram' }))
    expect(block.querySelector('.thread-diagram svg')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(writeText).toHaveBeenCalledWith('graph TD\n  A[Login] --> B[Home]')
  })

  test('text that is not a whole diagram yet shows as code, with no error; it is drawn once it reads as one', async () => {
    const { rerender } = render(<ThreadMarkdown text={'```mermaid\ngraph TD\n  A[Login] -->\n```'} />)
    const block = await screen.findByTestId('thread-diagram')
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(block.querySelector('.thread-diagram')).toBeNull()
    expect(block.querySelector('pre code')?.textContent).toContain('A[Login] -->')
    expect(screen.queryByRole('button', { name: 'Show code' })).toBeNull()
    rerender(<ThreadMarkdown text={'```mermaid\ngraph TD\n  A[Login] --> B[Home]\n```'} />)
    await waitFor(() => expect(screen.getByTestId('thread-diagram').querySelector('.thread-diagram svg')).not.toBeNull())
  })

  test('any other fenced block is still code', async () => {
    const { container } = render(<ThreadMarkdown text={'```ts\nconst a = 1\n```'} />)
    expect(container.querySelector('.thread-code-block pre code')?.textContent).toContain('const a = 1')
    expect(screen.queryByTestId('thread-diagram')).toBeNull()
  })
})
