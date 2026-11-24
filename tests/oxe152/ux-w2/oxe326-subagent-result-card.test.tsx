// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ptBrThread from '../../../shared/locales/pt-BR/thread.json'
import { SubagentResultCard } from '../../../src/components/Threads/SubagentResultCard'
import { ThreadSubagentActivity } from '../../../src/components/Threads/ThreadSubagentActivity'
import { i18n } from '../../../src/i18n'
import type { ThreadEvent } from '../../../shared/types/thread'

type SubagentEvent = Extract<ThreadEvent, { type: 'subagent' }>

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('OXE-326 · SubagentResultCard [data-ui="subagent-result"]', () => {
  it('renders [data-ui="subagent-result"] with status states done, failed, and running', () => {
    const { container, rerender } = render(
      <SubagentResultCard
        agentId="agent-1"
        title="Codebase Researcher"
        status="done"
        output="Found 4 matching files."
        durationMs={1500}
        metrics={['claude-sonnet-4-6', 'high']}
      />
    )

    const root = container.querySelector('[data-ui="subagent-result"]')
    expect(root).not.toBeNull()
    expect(root?.getAttribute('data-status')).toBe('done')
    expect(container.querySelector('[data-ui="status-signal"]')?.getAttribute('data-state')).toBe('done')
    expect(screen.getByText('Codebase Researcher')).toBeInTheDocument()
    expect(screen.getByText('Completed', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('1.5s · claude-sonnet-4-6 · high')).toBeInTheDocument()
    expect(screen.getByText('Found 4 matching files.')).toBeInTheDocument()

    rerender(
      <SubagentResultCard
        agentId="agent-2"
        status="failed"
        output="Command exited with code 1"
        durationMs={420}
      />
    )
    expect(container.querySelector('[data-ui="subagent-result"]')?.getAttribute('data-status')).toBe('failed')
    expect(container.querySelector('[data-ui="status-signal"]')?.getAttribute('data-state')).toBe('failed')
    expect(screen.getByText('agent-2')).toBeInTheDocument()
    expect(screen.getByText('Failed', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('420 ms')).toBeInTheDocument()

    rerender(<SubagentResultCard agentId="agent-3" status="running" />)
    expect(container.querySelector('[data-ui="subagent-result"]')?.getAttribute('data-status')).toBe('running')
    expect(container.querySelector('[data-ui="status-signal"]')?.getAttribute('data-state')).toBe('working')
    expect(screen.getByText('Running', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('Working in background…')).toBeInTheDocument()
  })

  it('expands and collapses long output and invokes optional action buttons', () => {
    const longOutput = 'Line 1 summary\n'.repeat(30).trim()
    const onOpenConversation = vi.fn()
    const onViewDetails = vi.fn()

    render(
      <SubagentResultCard
        agentId="agent-long"
        title="Audit Worker"
        status="done"
        output={longOutput}
        collapseThreshold={80}
        onOpenConversation={onOpenConversation}
        onViewDetails={onViewDetails}
      />
    )

    const toggle = screen.getByRole('button', { name: 'Show full output' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(longOutput)).toBeNull()

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText((_, node) => node?.tagName === 'P' && node.textContent === longOutput)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByRole('button', { name: 'Show full output' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }))
    expect(onOpenConversation).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'View details' }))
    expect(onViewDetails).toHaveBeenCalledOnce()
  })

  it('renders PT-BR copy when the language is pt-BR', async () => {
    if (!i18n.hasResourceBundle('pt-BR', 'thread')) {
      i18n.addResourceBundle('pt-BR', 'thread', ptBrThread, true, true)
    }
    await i18n.changeLanguage('pt-BR')

    render(
      <SubagentResultCard
        agentId="agent-pt"
        title="Pesquisador"
        status="done"
        summary="Resumo curto"
        output="Saída detalhada completa do subagente"
        onOpenConversation={vi.fn()}
        onViewDetails={vi.fn()}
      />
    )

    expect(screen.getByText('Concluído', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver saída completa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir conversa' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver detalhes' })).toBeInTheDocument()
  })

  it('wires SubagentResultCard into ThreadSubagentActivity for completed and failed outcomes', () => {
    const onOpenAgent = vi.fn()
    const event: SubagentEvent = {
      type: 'subagent',
      id: 'sub-1',
      action: 'spawnAgent',
      state: 'completed',
      receiverThreadIds: ['worker-done', 'worker-fail', 'worker-run'],
      model: 'claude-sonnet-4-6',
      startedAt: 1_000,
      completedAt: 3_500,
      agents: [
        { threadId: 'worker-done', status: 'completed', message: 'All checks passed.' },
        { threadId: 'worker-fail', status: 'failed', message: 'Lint error found.' },
        { threadId: 'worker-run', status: 'running' }
      ]
    }

    const { container } = render(<ThreadSubagentActivity event={event} onOpenAgent={onOpenAgent} />)

    const cards = container.querySelectorAll('[data-ui="subagent-result"]')
    expect(cards).toHaveLength(2)
    expect(cards[0].getAttribute('data-status')).toBe('done')
    expect(cards[1].getAttribute('data-status')).toBe('failed')
    expect(screen.getByText('All checks passed.')).toBeInTheDocument()
    expect(screen.getByText('Lint error found.')).toBeInTheDocument()

    const openButtons = screen.getAllByRole('button', { name: 'Open conversation' })
    fireEvent.click(openButtons[0])
    expect(onOpenAgent).toHaveBeenCalledWith('worker-done')
  })
})
