// Frozen acceptance test for 1.5.0 A12 PR 3 (T64 UI; OXE phase F2). The executor must not edit it.
// Contract: docs/roadmap-1.5/ccr-a12-ui-oxepost-agent-access.md; product and copy: docs/design/t64-oxepost-agent-access.md.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetApprovalsApi } from '../../../src/components/Approvals/approvalsApi'
import { installApprovalsMock, type ApprovalsMockHook, type MockRequestInput } from '../../../src/components/Approvals/approvalsMock'
import { resetApprovalsBoot } from '../../../src/components/Approvals/approvalsBoot'
import { useApprovalsStore } from '../../../src/components/Approvals/approvals.store'
import { ApprovalCenter } from '../../../src/components/Approvals/ApprovalCenter'

const ROOT = join(__dirname, '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
const TEXT = 'GET https://api.example.com/invoices?page=1\nX-Trace: [secret:API_KEY]\n\n'

let hook: ApprovalsMockHook
beforeEach(() => {
  resetApprovalsApi(); resetApprovalsBoot(); useApprovalsStore.getState().reset()
  hook = installApprovalsMock().hook
  vi.spyOn(document, 'hasFocus').mockImplementation(() => true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const show = async (partial: MockRequestInput): Promise<HTMLElement> => {
  act(() => { hook.request(partial) })
  render(<ApprovalCenter armMs={0} />)
  await waitFor(() => expect(screen.getByTestId('approval-dialog')).toBeInTheDocument())
  return screen.getByTestId('approval-agent-text')
}

describe('A12 PR 3 · the approval card masks a secret as •••• (NAME)', () => {
  it('an OxePost approval draws [secret:API_KEY] as a marker and keeps the text it was given', async () => {
    const box = await show({ id: 'post-1', kind: 'oxepost' as never, risk: 'low', agentText: TEXT })
    const shown = box.textContent ?? ''
    expect(shown).toContain('•••• (API_KEY)')
    expect(shown).not.toContain('[secret:')
    expect([...box.querySelectorAll('[data-secret]')].map(node => node.getAttribute('data-secret'))).toEqual(['API_KEY'])
    // Display only: what main hashed is untouched.
    const stored = useApprovalsStore.getState()
    expect(JSON.stringify(stored)).toContain('[secret:API_KEY]')
  })

  it('another kind shows the agent\'s words as written, so a lookalike is never drawn as a masked secret', async () => {
    const box = await show({ id: 'act-1', kind: 'action', risk: 'low', agentText: TEXT })
    expect(box.textContent).toContain('[secret:API_KEY]')
    expect(box.querySelector('[data-secret]')).toBeNull()
  })
})

/** Every .ts/.tsx file under a folder. */
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap(name => {
    const path = `${dir}/${name}`
    return statSync(join(ROOT, path)).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}

describe('A12 PR 3 · the OxePost renderer uses the person-only ops', () => {
  it('lists, sets and caps agent access through oxePost.call', () => {
    const post = sources('src/components/OxePost').map(read).join('\n')
    for (const op of ['agentAccessList', 'agentAccessSet', 'agentCeilingSet']) expect(post, op).toContain(op)
  })
})

describe('A12 PR 3 · T64 copy in both languages', () => {
  const strings = (locale: string): string => {
    const found: string[] = []
    const walk = (node: unknown): void => {
      if (node && typeof node === 'object') for (const value of Object.values(node as Record<string, unknown>)) walk(value)
      else if (typeof node === 'string') found.push(node)
    }
    walk(JSON.parse(read(`shared/locales/${locale}/post.json`)))
    return found.join('\n')
  }
  it.each([
    ['en', ['Agent access…', 'No access (default)', 'Read: agents may ask to send GET requests. Each one needs your approval.',
      'Read and write: every change needs your approval.', 'Agents can never send changes to a production environment.',
      'Not sent: agents only reach the hosts this collection already uses.']],
    ['pt-BR', ['Acesso de agentes…', 'Sem acesso (padrão)', 'Leitura: agentes podem pedir para enviar requisições GET. Cada uma precisa da sua aprovação.',
      'Leitura e escrita: toda alteração precisa da sua aprovação.', 'Agentes nunca enviam alterações para um ambiente de produção.',
      'Não enviado: agentes só acessam os hosts que esta coleção já usa.']]
  ])('%s', (locale, expected) => {
    const all = strings(locale as string)
    for (const text of expected as string[]) expect(all, text).toContain(text)
  })
})
