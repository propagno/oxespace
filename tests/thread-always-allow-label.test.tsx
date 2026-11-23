// A permission decision's label promises no more than the rule gives (8e, 22/11, on OxeChat F5): a Codex rule lasts
// for its session only (AlwaysAllowConfirm says so), so its menu item never says "in this project". A project rule
// keeps A10's label.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ThreadRequestCard } from '../src/components/Threads/ThreadRequestCard'
import { changeLanguage, i18n } from '../src/i18n'

const CODEX = { provider: 'codex', text: 'npm test', scope: 'session' } as const
const CLAUDE = { provider: 'claude', text: 'Bash(npm test:*)', scope: 'project' } as const
const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string

async function allowMenu(rule: typeof CODEX | typeof CLAUDE) {
  const alwaysAllow = vi.fn(async () => ({ ok: true, rule }))
  Object.defineProperty(window, 'oxe', { configurable: true, value: { approvals: { alwaysAllow } } })
  const request = {
    id: 'r1', nativeId: 'n-1', nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'npm test', command: 'npm test',
    generation: 1, createdAt: 1, state: 'pending', availableDecisions: ['accept', 'decline'],
    impact: { where: 'shop', affects: { count: 0, unit: 'files' }, reversible: true, risk: 'low', kind: 'command', text: 'npm test', lang: 'shell' },
    alwaysAllow: { offered: true, rule }
  }
  const onRespond = vi.fn(async () => undefined)
  render(<ThreadRequestCard request={request as never} agent="Agent" disabled={false} onRespond={onRespond as never} conversationId="t-1" />)
  await userEvent.click(await screen.findByRole('button', { name: tt('request.allowMenu') }))
  const menu = await screen.findByRole('menu')
  return { menu, alwaysAllow, onRespond, items: within(menu).getAllByRole('menuitem').map(item => item.textContent?.trim()) }
}

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe.each([
  ['en', 'Always allow…', 'Always allow in this project…', 'See impact', 'Allowed for this Codex session only.'],
  ['pt-BR', 'Sempre permitir…', 'Sempre permitir neste projeto…', 'Ver impacto', 'Permitido só nesta sessão do Codex.']
] as const)('(%s) the Always allow item', (locale, plain, inProject, seeImpact, sessionOnly) => {
  test('a session rule does not promise the project, and opens the confirm that says session only', { timeout: 30_000 }, async () => {
    await changeLanguage(locale)
    const { menu, alwaysAllow, onRespond, items } = await allowMenu(CODEX)
    expect(items).toEqual([plain, seeImpact])
    await userEvent.click(within(menu).getByRole('menuitem', { name: plain }))
    expect(within(await screen.findByRole('dialog')).getByText(sessionOnly)).toBeInTheDocument()
    expect(alwaysAllow, 'opening writes no rule').not.toHaveBeenCalled()
    expect(onRespond, 'opening answers nothing').not.toHaveBeenCalled()
  })

  test("a project rule keeps A10's label", { timeout: 30_000 }, async () => {
    await changeLanguage(locale)
    const { items } = await allowMenu(CLAUDE)
    expect(items).toEqual([inProject, seeImpact])
  })
})
