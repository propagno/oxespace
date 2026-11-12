// The visual round of 2026-11-12 (VIS-08, VIS-13, VIS-14), the parts a test can read without a layout engine.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NeedsYouPill } from '../../src/components/Navigation/NeedsYouPill'
import { effortLabel } from '../../src/components/Threads/effortLabel'
import { ThreadUsageRing } from '../../src/components/Threads/ThreadUsageRing'
import { changeLanguage, i18n } from '../../src/i18n'
import { useThreadStore } from '../../src/store/thread.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

afterEach(async () => { cleanup(); await changeLanguage('en'); delete (window as { oxe?: unknown }).oxe })

describe('VIS-14 · what the app says is in the person\'s language', () => {
  it('names the reasoning effort in English and in Portuguese, and shows an effort it does not know as the provider spells it', async () => {
    const t = () => i18n.getFixedT(null, 'thread')
    expect(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(effort => effortLabel(t(), effort)))
      .toEqual(['None', 'Minimal', 'Low', 'Medium', 'High', 'Extra high', 'Max'])
    expect(effortLabel(t(), 'LOW')).toBe('Low')
    expect(effortLabel(t(), 'turbo')).toBe('Turbo')
    expect(effortLabel(t(), '')).toBe('')
    await changeLanguage('pt-BR')
    expect(['low', 'medium', 'high', 'xhigh'].map(effort => effortLabel(t(), effort))).toEqual(['Baixo', 'Médio', 'Alto', 'Extra alto'])
    // Never the English word in a Portuguese screen (it was "Low").
    expect(effortLabel(t(), 'low')).not.toBe('Low')
    expect(effortLabel(t(), 'turbo')).toBe('Turbo')
  })

  it('says that no agent is working in words: Portuguese counts zero as one ("0 agente trabalhando")', async () => {
    const line = (count: number) => i18n.t('statusBar.agentsWorking', { count })
    expect([0, 1, 2].map(line)).toEqual(['No agents working', '1 agent working', '2 agents working'])
    await changeLanguage('pt-BR')
    expect([0, 1, 2].map(line)).toEqual(['Nenhum agente trabalhando', '1 agente trabalhando', '2 agentes trabalhando'])
  })
})

describe('VIS-08 · the pill keeps the room of "Nothing waiting" when something starts waiting', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: [] })
    useThreadStore.setState({ threads: [], unreadIds: [] })
  })

  it('with nothing waiting there is one text, the button\'s', () => {
    render(<NeedsYouPill />)
    expect(screen.getAllByText('Nothing waiting')).toHaveLength(1)
    expect(screen.getByRole('button')).toHaveTextContent('Nothing waiting')
  })

  it('with something waiting, the old text only holds the width: not read, not clickable, and the button says the count', () => {
    useThreadStore.setState({ threads: [{ id: 'a', status: 'approval' }] as never })
    render(<NeedsYouPill />)
    const button = screen.getByTestId('needs-you-pill')
    expect(button).toHaveTextContent('1 needs you')
    expect(button).not.toHaveTextContent('Nothing waiting')
    const sizer = screen.getByText('Nothing waiting').closest('[aria-hidden="true"]')
    expect(sizer).not.toBeNull()
    expect(sizer!.tagName).toBe('SPAN')
    expect(sizer!.contains(button)).toBe(false)
    // One button only: the sizer is not a second way in.
    expect(screen.getAllByRole('button')).toHaveLength(1)
    // Both sit in the same slot, which is what keeps the width.
    expect(sizer!.parentElement).toBe(button.parentElement)
  })
})

describe('VIS-13 · the context ring says its number', () => {
  beforeEach(() => { (window as unknown as { oxe: unknown }).oxe = {} })

  it('an open conversation with nothing used yet reads 0%, not an empty circle', () => {
    render(<ThreadUsageRing provider="claude" idle threadId="t-1" />)
    const ring = screen.getByRole('button')
    expect(ring).toHaveTextContent('0%')
    // The visible figure is part of the name (WCAG 2.5.3).
    expect(ring.getAttribute('aria-label')).toContain('0%')
  })

  it('shows the share of the context window the provider reported, the same figure as its name', () => {
    render(<ThreadUsageRing provider="codex" idle threadId="t-1" context={{ usedTokens: 74_000, windowTokens: 200_000, percentage: 37, categories: [], capturedAt: 1, source: 'codex-token-usage' }} />)
    const ring = screen.getByRole('button')
    expect(ring).toHaveTextContent('37%')
    expect(ring.getAttribute('aria-label')).toContain('37%')
  })
})
