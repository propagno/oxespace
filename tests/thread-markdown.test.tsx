import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
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

it('keeps external links functional without navigating the app or executing HTML', () => {
  const open = vi.spyOn(window, 'open').mockImplementation(() => null)
  render(<ThreadMarkdown text={'[Docs](https://example.com/docs)\n\n[Unsafe](javascript:alert(1))\n\n<script>alert(1)</script>'} />)
  fireEvent.click(screen.getByRole('link', { name: 'Docs' }))
  expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer')
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(document.querySelector('script')).toBeNull()
})

it('reparses an incomplete streamed table when its rows arrive', () => {
  const header = '| A | B |\n| --- | --- |'
  const view = render(<ThreadMarkdown text={header} />)
  view.rerender(<ThreadMarkdown text={`${header}\n| First | Second |`} />)
  expect(screen.getByRole('cell', { name: 'Second' })).toBeVisible()
})
