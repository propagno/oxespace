import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ThreadContextReport } from '../../../shared/types/thread'
import { cutSafe } from '../../../src/components/Threads/deriveThreadActivity'
import { NowLine } from '../../../src/components/Threads/NowLine'
import { MermaidEnlarged } from '../../../src/components/Threads/ThreadMermaid'
import { ThreadUsageRing } from '../../../src/components/Threads/ThreadUsageRing'

// OXE-379 part A (Heavy User): the now line cut words ("calculat.", "tota."); the usage ring had no one-click Compact;
// the Mermaid Enlarge dialog had no zoom, pan or export.

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('OXE-379 · the now line never cuts a word', () => {
  test('a long text ends at the last whole word that fits, with "…"', () => {
    const text = 'I calculated the totals for every region and checked them against the report'
    const cut = cutSafe(text, 40)
    expect(cut.length).toBeLessThanOrEqual(40)
    expect(cut.endsWith('…')).toBe(true)
    const words = cut.slice(0, -1).split(' ')
    for (const word of words) expect(text.split(' ')).toContain(word)
    expect(cutSafe('short enough', 40)).toBe('short enough')
  })

  test('NowLine does not add the sentence period after "…"', () => {
    render(<NowLine activity={{ kind: 'done', at: 1, text: cutSafe('I calculated the totals for every region and checked them', 30) }} agent="Claude" onAction={() => undefined} />)
    const line = screen.getByRole('status').textContent ?? ''
    expect(line).toMatch(/…$/)
    expect(line).not.toContain('….')
    expect(line).not.toMatch(/\b(calculat|tota)\./)
  })
})

describe('OXE-379 · Compact in one click from the usage ring', () => {
  const report: ThreadContextReport = { usedTokens: 180_000, windowTokens: 200_000, percentage: 90, categories: [], capturedAt: 1, source: 'claude-control' }
  let command: ReturnType<typeof vi.fn>
  beforeEach(() => {
    command = vi.fn(async () => ({ kind: 'sent' }))
    Object.defineProperty(window, 'oxe', { configurable: true, value: { agentCredits: { get: vi.fn(async () => null) }, thread: { command, contextUsage: vi.fn(async () => null) } } })
  })

  test('the popover runs /compact in the conversation', async () => {
    render(<ThreadUsageRing provider="claude" idle threadId="t1" context={report} />)
    fireEvent.click(screen.getByRole('button', { name: /^Usage:/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Compact' }))
    expect(command).toHaveBeenCalledWith('t1', '/compact')
  })

  test('not while a turn runs, and not for Antigravity, whose /compact is not verified', async () => {
    const view = render(<ThreadUsageRing provider="claude" idle={false} threadId="t1" context={report} />)
    fireEvent.click(screen.getByRole('button', { name: /^Usage:/ }))
    expect(await screen.findByRole('button', { name: 'Compact' })).toBeDisabled()
    view.unmount()
    render(<ThreadUsageRing provider="antigravity" idle threadId="t2" context={{ ...report, source: 'antigravity-usage' }} />)
    fireEvent.click(screen.getByRole('button', { name: /^Usage:/ }))
    await waitFor(() => expect(document.querySelector('.thread-usage-popover')).not.toBeNull())
    expect(screen.queryByRole('button', { name: 'Compact' })).toBeNull()
  })
})

describe('OXE-379 · Mermaid Enlarge zooms, pans and exports', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="100%" style="max-width: 400px;"><rect width="400" height="200"/></svg>'
  const canvas = (root: HTMLElement) => root.querySelector<HTMLElement>('.thread-diagram-canvas')!

  test('zoom in and out by steps from the drawing\'s own size, reset to 100%, and Ctrl+wheel', () => {
    const { container } = render(<MermaidEnlarged svg={svg} />)
    expect(canvas(container).style.width).toBe('400px')
    expect(canvas(container).querySelector('svg')!.style.maxWidth).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(canvas(container).style.width).toBe('500px')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(canvas(container).style.width).toBe('300px')
    fireEvent.click(screen.getByRole('button', { name: /reset to 100%/ }))
    expect(canvas(container).style.width).toBe('400px')
    fireEvent.wheel(screen.getByRole('img'), { deltaY: -100, ctrlKey: true })
    expect(canvas(container).style.width).toBe('500px')
  })

  test('dragging pans the drawing', () => {
    render(<MermaidEnlarged svg={svg} />)
    const view = screen.getByRole('img')
    let left = 100, top = 50
    Object.defineProperty(view, 'scrollLeft', { configurable: true, get: () => left, set: value => { left = value } })
    Object.defineProperty(view, 'scrollTop', { configurable: true, get: () => top, set: value => { top = value } })
    fireEvent.pointerDown(view, { button: 0, clientX: 200, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(view, { clientX: 150, clientY: 170, pointerId: 1 })
    expect(left).toBe(150)
    expect(top).toBe(80)
    fireEvent.pointerUp(view, { pointerId: 1 })
    fireEvent.pointerMove(view, { clientX: 0, clientY: 0, pointerId: 1 })
    expect(left).toBe(150)
  })

  test('SVG downloads the drawing as diagram.svg', async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return 'blob:diagram' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const clicks: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this.download) })
    render(<MermaidEnlarged svg={svg} />)
    fireEvent.click(screen.getByRole('button', { name: 'SVG' }))
    expect(clicks).toEqual(['diagram.svg'])
    expect(blobs[0].type).toBe('image/svg+xml')
    await act(async () => { expect(await blobs[0].text()).toBe(svg) })
    expect(screen.getByRole('button', { name: 'PNG' })).toBeInTheDocument()
  })
})
