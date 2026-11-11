// Frozen acceptance test for 1.5.0 A26 on screen (DESIGN U7.3, OXE program, phase F7, task FE-AP3). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f7-design.md (U7.3 and the #714 update).
// Contract (BACKEND #714 §Contract): ThreadRequest.alwaysAllow = { offered, reasonKind? ('destructive' | 'network' | 'push' |
// 'compound'), rule? { provider: 'claude' | 'codex', text, scope: 'project' | 'session' } }; window.oxe.approvals.alwaysAllow(requestId)
// → { ok: true, rule } | { ok: false, code } (main only writes the rule; the card then answers accept itself). An offer can
// carry runsProjectCode: true and definedIn ('package.json'), and the confirm then says it runs this project's code. The renderer part is
// ThreadRequestCard (src/components/Threads/ThreadRequestCard.tsx), with the toast through src/ui/Toast.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Props = Record<string, unknown>
const IMPACT = { where: 'shop', affects: { count: 0, unit: 'files' }, reversible: true, risk: 'low', kind: 'command', text: 'npm test', lang: 'shell' }
const CLAUDE_RULE = { offered: true, rule: { provider: 'claude', text: 'Bash(npm test:*)', scope: 'project' } }
const CODEX_RULE = { offered: true, rule: { provider: 'codex', text: 'npm test', scope: 'session' } }
const request = (alwaysAllow: Props, text = 'npm test') => ({
  id: 'r1', nativeId: 'n-1', nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: text, toolName: 'Bash', command: text,
  generation: 1, createdAt: 1, state: 'pending', availableDecisions: ['accept', 'decline'], impact: { ...IMPACT, text }, alwaysAllow
})
function mockMain(result: Props = { ok: true, rule: CLAUDE_RULE.rule }) {
  const approvals = { alwaysAllow: vi.fn(async () => result) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, approvals } })
  return approvals
}
async function renderCard(alwaysAllow: Props, text?: string) {
  const { ThreadRequestCard } = await import('../../../src/components/Threads/ThreadRequestCard')
  const { Toaster } = await import('../../../src/ui/Toast')
  const onRespond = vi.fn(async () => undefined)
  const Card = ThreadRequestCard as unknown as (props: Props) => JSX.Element
  render(<><Card request={request(alwaysAllow, text)} agent="Claude" disabled={false} onRespond={onRespond} conversationId="t-1" /><Toaster /></>)
  return onRespond
}
const actionButtons = () => screen.getAllByRole('button').map(button => button.textContent?.replace(/\s+[DA]$/, '').trim()).filter(label => label !== 'Copy exact text')

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('U7.3 · Always allow, with the provider rule', () => {
  test('an offered command reads Deny, Allow once, Always allow…', { timeout: 30_000 }, async () => {
    mockMain()
    await renderCard(CLAUDE_RULE)
    await screen.findByRole('button', { name: 'Always allow…' })
    expect(actionButtons()).toEqual(['Deny', 'Allow once', 'Always allow…'])
  })

  test('Always allow… shows the exact Claude project rule with Cancel focused; Cancel writes nothing', { timeout: 30_000 }, async () => {
    const main = mockMain()
    const onRespond = await renderCard(CLAUDE_RULE)
    await userEvent.click(await screen.findByRole('button', { name: 'Always allow…' }))
    const confirm = await screen.findByRole('dialog')
    expect(within(confirm).getByText(/Adds to this project's Claude Code rules:/)).toBeInTheDocument()
    expect(within(confirm).getByText('Bash(npm test:*)')).toBeInTheDocument()
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(main.alwaysAllow).not.toHaveBeenCalled()
    expect(onRespond).not.toHaveBeenCalled()
  })

  test('confirming writes the rule through main, answers accept, and the toast offers Open to revoke it', { timeout: 30_000 }, async () => {
    const main = mockMain()
    const onRespond = await renderCard(CLAUDE_RULE)
    await userEvent.click(await screen.findByRole('button', { name: 'Always allow…' }))
    const confirm = await screen.findByRole('dialog')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Always allow' }))
    expect(main.alwaysAllow).toHaveBeenCalledWith('r1')
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith({ decision: 'accept' }))
    expect(await screen.findByText(/Always allowed: npm test · revoke in What agents can do/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
  })

  test('a refusal from main answers nothing and shows no Always allowed toast', { timeout: 30_000 }, async () => {
    const main = mockMain({ ok: false, code: 'approvals.alwaysAllow.outsideProject' })
    const onRespond = await renderCard(CLAUDE_RULE)
    await userEvent.click(await screen.findByRole('button', { name: 'Always allow…' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Always allow' }))
    await waitFor(() => expect(main.alwaysAllow).toHaveBeenCalledWith('r1'))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(onRespond).not.toHaveBeenCalled()
    expect(screen.queryByText(/Always allowed:/)).toBeNull()
  })

  test("a rule for a project script says it runs this project's code, and where the script is defined", { timeout: 30_000 }, async () => {
    mockMain()
    await renderCard({ ...CLAUDE_RULE, runsProjectCode: true, definedIn: 'package.json' })
    await userEvent.click(await screen.findByRole('button', { name: 'Always allow…' }))
    const confirm = await screen.findByRole('dialog')
    expect(within(confirm).getByText(/runs this project's code/)).toBeInTheDocument()
    expect(within(confirm).getByText(/package.json/)).toBeInTheDocument()
  })

  test('a Codex rule says it is for this Codex session only', { timeout: 30_000 }, async () => {
    mockMain({ ok: true, rule: CODEX_RULE.rule })
    await renderCard(CODEX_RULE)
    await userEvent.click(await screen.findByRole('button', { name: 'Always allow…' }))
    expect(within(await screen.findByRole('dialog')).getByText('Allowed for this Codex session only.')).toBeInTheDocument()
  })

  test.each([
    ['destructive', 'rm -rf dist', "Always allow isn't offered for destructive commands."],
    ['network', 'curl https://example.com', "Always allow isn't offered for network commands."],
    ['push', 'git push origin main', "Always allow isn't offered for push commands."],
    ['compound', 'npm test && npm run lint', "Always allow isn't offered for commands that chain several steps."],
    ['code', 'node -e "process.exit(0)"', "Always allow isn't offered for commands that run code given on the command line."],
    ['elevation', 'sudo npm test', "Always allow isn't offered for commands that run as administrator."],
    ['broad', 'npm', "Always allow isn't offered for a rule this broad. Allow it once instead."],
    ['redirect', 'npm test > out.txt', "Always allow isn't offered for commands that redirect output into files."]
  ])('a command refused as %s gets no Always allow, and the reason line takes its place', { timeout: 30_000 }, async (reasonKind, text, line) => {
    mockMain()
    await renderCard({ offered: false, reasonKind }, text)
    expect(await screen.findByText(line)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Always allow/ })).toBeNull()
  })

  test('Always allow reads in pt-BR', { timeout: 30_000 }, async () => {
    await changeLanguage('pt-BR')
    mockMain()
    await renderCard(CLAUDE_RULE)
    await userEvent.click(await screen.findByRole('button', { name: 'Sempre permitir…' }))
    expect(within(await screen.findByRole('dialog')).getByText(/Adiciona às regras do Claude Code deste projeto:/)).toBeInTheDocument()
    cleanup()
    mockMain()
    await renderCard({ offered: false, reasonKind: 'network' }, 'curl https://example.com')
    expect(await screen.findByText('Sempre permitir não é oferecido para comandos de rede.')).toBeInTheDocument()
  })
})
