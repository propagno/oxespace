// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../src/i18n'
import { ThreadContextMenu } from '../src/components/Threads/ThreadContextMenu'

const edit = vi.fn(async () => true)
const writeText = vi.fn(async () => true)

function View({ onQuote }: { onQuote: (text: string) => void }) {
  return <section className="thread-view">
    <ThreadContextMenu onQuote={onQuote} />
    <header data-testid="chrome">Conversation title</header>
    <div className="thread-timeline">
      <article className="thread-message is-assistant" data-testid="message">
        <div className="thread-markdown">The test fails because total() ignores qty.</div>
        <div className="thread-message-actions"><button type="button" aria-label="Quote" onClick={() => onQuote('RAW **markdown**')} /><button type="button" aria-label="Copy" data-testid="row-copy" /></div>
      </article>
    </div>
    <textarea data-testid="field" defaultValue="hello world" />
  </section>
}

const labels = (): string[] => screen.queryAllByRole('menuitem').map(item => (item.textContent ?? '').replace(/Ctrl\+\w$/, '').trim())
const openOn = async (element: Element): Promise<void> => { await act(async () => { fireEvent.contextMenu(element, { clientX: 40, clientY: 60 }) }); await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) }) }

describe('the right-click menu of a conversation', () => {
  beforeEach(() => {
    edit.mockClear(); writeText.mockClear()
    ;(window as unknown as { oxe: unknown }).oxe = { clipboard: { edit, writeText } }
    Element.prototype.scrollIntoView ??= () => undefined
    Element.prototype.hasPointerCapture ??= () => false
  })
  afterEach(() => { cleanup(); delete (window as unknown as { oxe?: unknown }).oxe })

  test('in a text field: the editing commands; Cut and Copy wait for a selection', async () => {
    render(<View onQuote={() => undefined} />)
    const field = screen.getByTestId('field') as HTMLTextAreaElement
    field.setSelectionRange(0, 0)
    await openOn(field)
    expect(labels()).toEqual(['Cut', 'Copy', 'Paste', 'Select all'])
    const disabled = screen.getAllByRole('menuitem').filter(item => item.hasAttribute('data-disabled')).map(item => item.textContent?.replace(/Ctrl\+\w$/, '').trim())
    expect(disabled).toEqual(['Cut', 'Copy'])
  })

  test('Paste runs through main on the field, after the menu closed', async () => {
    render(<View onQuote={() => undefined} />)
    const field = screen.getByTestId('field') as HTMLTextAreaElement
    await openOn(field)
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Paste/ })) })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)) })
    expect(edit).toHaveBeenCalledWith('paste')
    expect(document.activeElement).toBe(field)
  })

  test('on a message: its own Copy and Quote', async () => {
    const onQuote = vi.fn()
    render(<View onQuote={onQuote} />)
    const clicked = vi.fn()
    screen.getByTestId('row-copy').addEventListener('click', clicked)
    await openOn(screen.getByTestId('message'))
    expect(labels()).toEqual(['Copy message', 'Quote message'])
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Quote message' })) })
    // The row's own action: what the agent wrote, marks included.
    expect(onQuote).toHaveBeenCalledWith('RAW **markdown**')
    // The menu chosen from is gone before the next right-click; opening over one that is still closing is a race.
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toEqual([]))
    await openOn(screen.getByTestId('message'))
    const copy = await screen.findByRole('menuitem', { name: 'Copy message' })
    await act(async () => { fireEvent.click(copy) })
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  test('nothing opens on the chrome, and a right-click something else answered is left to it', async () => {
    render(<View onQuote={() => undefined} />)
    await openOn(screen.getByTestId('chrome'))
    expect(screen.queryAllByRole('menuitem')).toEqual([])
    const message = screen.getByTestId('message')
    message.addEventListener('contextmenu', event => event.preventDefault(), { capture: true })
    await openOn(message)
    expect(screen.queryAllByRole('menuitem')).toEqual([])
  })
})
