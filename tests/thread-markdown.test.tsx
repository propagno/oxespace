import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { stubOpenExternal } from './helpers/openExternal'
import { ThreadMarkdown } from '../src/components/Threads/ThreadMarkdown'
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('renders the reported comparison as a real table with code and emphasis in cells', () => {
  render(<ThreadMarkdown text={'| Prioridade | Melhoria | Motivo |\n| --- | --- | --- |\n| **Alta** | Dividir o `App.tsx` | Reduzir acoplamento |\n| Média | Preservar erros | Facilitar diagnóstico |'} />)
  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('row')).toHaveLength(3)
  expect(within(table).getAllByRole('columnheader')).toHaveLength(3)
  expect(within(table).getByText('App.tsx').tagName).toBe('CODE')
  expect(within(table).getByText('Alta').tagName).toBe('STRONG')
  expect(screen.getByRole('region', { name: 'Message table' })).toHaveAttribute('tabindex', '0')
})

it('preserves code whitespace when copying and renders nested and task lists', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  render(<ThreadMarkdown text={'## Verificação\n\n- Item\n  - Subitem\n\n- [x] Concluído\n- [ ] Pendente\n\n> Observação\n\n```ts\nconst value = 1\n  console.log(value)\n```'} />)
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Verificação')
  expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  expect(screen.getAllByRole('checkbox')[0]).toBeChecked()
  expect(screen.getAllByRole('checkbox')[1]).toBeDisabled()
  expect(screen.getByText('Observação').closest('blockquote')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
  await screen.findByText('Copied')
  expect(writeText).toHaveBeenCalledWith('const value = 1\n  console.log(value)\n')
})

it('keeps external links functional without navigating the app or executing HTML', async () => {
  localStorage.clear()
  const open = stubOpenExternal()
  render(<ThreadMarkdown text={'[Docs](https://example.com/docs)\n\n[Unsafe](javascript:alert(1))\n\n<script>alert(1)</script>'} />)
  // Text that names something other than the address shows the real host after it, and asks before opening.
  fireEvent.click(screen.getByRole('link', { name: 'Docs (example.com)' }))
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: 'Open' }))
  await waitFor(() => expect(open).toHaveBeenCalledWith('https://example.com/docs'))
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(document.querySelector('script')).toBeNull()
})

it('reparses an incomplete streamed table when its rows arrive', () => {
  const header = '| A | B |\n| --- | --- |'
  const view = render(<ThreadMarkdown text={header} />)
  view.rerender(<ThreadMarkdown text={`${header}\n| First | Second |`} />)
  expect(screen.getByRole('cell', { name: 'Second' })).toBeVisible()
})

describe('F33: project paths in the agent text', () => {
  it('turns inline code that names a project file into a link with its line; code blocks and other code stay plain', async () => {
    const { render, screen, cleanup } = await import('@testing-library/react')
    const { PathScopeContext } = await import('../src/components/PathMenu/PathLink')
    const { ThreadMarkdown } = await import('../src/components/Threads/ThreadMarkdown')
    const opened: unknown[] = []
    const scope = { workspaceId: 'ws', rootPath: '/repo', openInOxespace: (path: unknown) => { opened.push(path) } }
    render(<PathScopeContext.Provider value={scope}><ThreadMarkdown text={'Fixed `src/app.ts:12`, see `npm run dev` and `../other/x.ts`.\n\n```\nsrc/app.ts\n```'} /></PathScopeContext.Provider>)
    const links = screen.getAllByRole('button', { name: /src\/app\.ts/ })
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('aria-label')).toMatch(/src\/app\.ts, line 12/)
    links[0].click()
    expect(opened).toEqual([{ relativePath: 'src/app.ts', line: 12 }])
    expect(screen.queryByRole('button', { name: /npm|other/ })).toBeNull()
    cleanup()
    // Without a project (an approval preview), nothing is a link.
    render(<ThreadMarkdown text={'Fixed `src/app.ts:12`.'} />)
    expect(screen.queryByRole('button', { name: /src\/app\.ts/ })).toBeNull()
    cleanup()
  })
})

describe('F33: code inside a link', () => {
  it('stays plain, never a path button inside an anchor', async () => {
    const { render, screen, cleanup } = await import('@testing-library/react')
    const { PathScopeContext } = await import('../src/components/PathMenu/PathLink')
    const { ThreadMarkdown } = await import('../src/components/Threads/ThreadMarkdown')
    render(<PathScopeContext.Provider value={{ workspaceId: 'ws', rootPath: '/repo', openInOxespace: () => undefined }}><ThreadMarkdown text={'See [`src/app.ts`](https://example.com/x) and `src/app.ts`.'} /></PathScopeContext.Provider>)
    expect(screen.getAllByRole('button', { name: 'src/app.ts' })).toHaveLength(1)
    cleanup()
  })
})
