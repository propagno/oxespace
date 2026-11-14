import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadSnapshot } from '../../shared/types/thread'
import { planOnlyTurn, ThreadPlanOnlyHint } from '../../src/components/Threads/ThreadPlanOnlyHint'
import { changeLanguage } from '../../src/i18n'

afterEach(async () => { cleanup(); await changeLanguage('en') })

type Shape = Pick<ThreadSnapshot, 'thread' | 'turns'>
function conversation(thread: Partial<ThreadSnapshot['thread']>, last: ThreadSnapshot['turns'][number]['status'] = 'completed'): Shape {
  return {
    thread: { id: 't', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'claude', title: 'Plan the price change', status: 'idle', createdAt: 1, updatedAt: 2, mode: 'plan', ...thread },
    turns: [{ id: 'turn-1', sequence: 1, status: 'completed', configuration: {} }, { id: 'turn-2', sequence: 2, status: last, configuration: {} }]
  } as Shape
}

describe('plan mode in a Read only conversation (CHAT-5)', () => {
  it('the latest finished turn says what it takes to run the plan; a conversation is Read only until it says otherwise', () => {
    expect(planOnlyTurn(conversation({ access: 'read-only' }), 'turn-2')).toBe(true)
    expect(planOnlyTurn(conversation({}), 'turn-2')).toBe(true)
    // Only the latest turn, and only once it finished.
    expect(planOnlyTurn(conversation({ access: 'read-only' }), 'turn-1')).toBe(false)
    expect(planOnlyTurn(conversation({ access: 'read-only' }, 'running'), 'turn-2')).toBe(false)
    expect(planOnlyTurn(conversation({ access: 'read-only' }, 'interrupted'), 'turn-2')).toBe(false)
  })

  it('with Can edit the plan has its review card, and outside Plan there is no plan to run: no line', () => {
    expect(planOnlyTurn(conversation({ access: 'workspace-write' }), 'turn-2')).toBe(false)
    expect(planOnlyTurn(conversation({ access: 'full-access' }), 'turn-2')).toBe(false)
    expect(planOnlyTurn(conversation({ access: 'read-only', mode: 'default' }), 'turn-2')).toBe(false)
    expect(planOnlyTurn(conversation({ access: 'read-only', mode: undefined }), 'turn-2')).toBe(false)
    // Measured with Claude only: the other agents keep their own behaviour.
    expect(planOnlyTurn(conversation({ access: 'read-only', provider: 'codex' }), 'turn-2')).toBe(false)
    expect(planOnlyTurn(null, 'turn-2')).toBe(false)
  })

  it('names the access to change to, and its button opens the access menu', () => {
    const open = vi.fn()
    render(<ThreadPlanOnlyHint agent="Claude" onChangeAccess={open} />)
    expect(screen.getByTestId('plan-only-hint')).toHaveTextContent('In Read only, Claude plans but does not carry the plan out. To run it, change access to Can edit and ask it to go ahead.')
    fireEvent.click(screen.getByRole('button', { name: 'Change access' }))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('reads in pt-BR with the names the access menu uses', async () => {
    await changeLanguage('pt-BR')
    render(<ThreadPlanOnlyHint agent="Claude" onChangeAccess={vi.fn()} />)
    expect(screen.getByTestId('plan-only-hint')).toHaveTextContent('Em Somente leitura, Claude planeja mas não executa o plano. Para executar, mude o acesso para Pode editar e peça para seguir.')
    expect(screen.getByRole('button', { name: 'Mudar acesso' })).toBeVisible()
  })
})
