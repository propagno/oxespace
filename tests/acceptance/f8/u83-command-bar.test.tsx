// Frozen acceptance test for 1.5.0 A31 on screen (DESIGN U8.3, OXE program, phase F8, task FE-A31). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f8-design.md (U8.3).
// Contract (BACKEND #717 @ 1381a576 §A31): shared/command-bar exports parseCommandLine(text, skillNames?), COMMAND_CATALOG
// [{ id, ipc, fixedArgs?, confirm?, fallback, shortcut }] and commandRequest(parsed, context: CommandContext { workspaceId,
// threadId?, pane?: { id, agent }, enabledSkills, requests }) → { ok: true, ipc, args, requestIds? } | { ok: false, refusal }.
// The window calls commandRequest and then the window.oxe method at that ipc path with those args; it never builds IPC
// itself. The renderer parts, in src/components/CommandBar/:
// - CommandBar({ open, onOpenChange, context, onRun(parsed) }) in CommandBar.tsx: the combobox over a listbox of labelled
//   groups, the debounced polite count, the hints, "Also: {button}" and the shortcut per result; a refusal shows as an
//   alert in the bar; onRun gets what is not an IPC request (an agent line, open, a view);
// - CommandBarTrigger({ onOpen }) in CommandBarTrigger.tsx, the title bar's "Ask, run or go to…"; Ctrl K is commandBar.open.
// The bar acts through onRun (the window's existing actions) or skill.invoke; it never approves (BACKEND's a31 pins the
// catalog). U8.3a's axe run and U8.3d's step counts (HML K1–K4) are the e2e run.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Row = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

const SKILLS = [
  { name: 'pix-rules', description: 'Checks a change against the Pix rules', agents: [], filePath: '/s/pix.md', body: '', source: 'workspace', mtimeMs: 1 },
  { name: 'release-notes', description: 'Writes the release notes', agents: [], filePath: '/s/rel.md', body: '', source: 'user', mtimeMs: 1 }
]
const WORKSPACES = [...['old-billing', 'billing-staging', 'billing'].map(name => ({ id: `ws-${name}`, name, rootPath: `/repo/${name}`, themeId: 'midnight', panes: [] })),
  { id: 'A', name: 'shop', rootPath: '/repo/shop', themeId: 'midnight', panes: [] }, { id: 'B', name: 'payments', rootPath: '/repo/payments', themeId: 'midnight', panes: [] }]
const CONTEXT = {
  workspaceId: 'A', threadId: 't-A', pane: { id: 'p-A', agent: true }, enabledSkills: ['pix-rules', 'release-notes'],
  requests: [{ workspaceId: 'A', threadId: 't-A', requestId: 'r-A1' }, { workspaceId: 'B', threadId: 't-B', requestId: 'r-B1' }]
}
async function renderBar(context: Row = CONTEXT) {
  const skill = { invoke: vi.fn(async () => undefined), list: vi.fn(async () => SKILLS) }
  const thread = { respond: vi.fn(async () => undefined) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, skill, thread } })
  const { useSkillStore } = await import('../../../src/store/skill.store')
  const { useWorkspaceStore } = await import('../../../src/store/workspace.store')
  act(() => { useSkillStore.setState({ skills: SKILLS as never }); useWorkspaceStore.setState({ workspaces: WORKSPACES as never }) })
  const { CommandBar } = await load<{ CommandBar: (props: Row) => JSX.Element }>('src/components/CommandBar/CommandBar')
  const onRun = vi.fn()
  render(<CommandBar open onOpenChange={vi.fn()} context={context} onRun={onRun} />)
  const input = await screen.findByRole('combobox')
  return { input, onRun, skill, thread }
}
const options = () => screen.queryAllByRole('option')

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('U8.3 · The command bar', () => {
  test('the title bar trigger reads "Ask, run or go to…" with its shortcut, and Ctrl K opens the bar', async () => {
    const { CommandBarTrigger } = await load<{ CommandBarTrigger: (props: Row) => JSX.Element }>('src/components/CommandBar/CommandBarTrigger')
    const onOpen = vi.fn()
    render(<CommandBarTrigger onOpen={onOpen} />)
    const trigger = screen.getByRole('button', { name: /Ask, run or go to…/ })
    expect(trigger.getAttribute('aria-keyshortcuts')).toMatch(/Control\+K|Meta\+K/)
    await userEvent.click(trigger)
    expect(onOpen).toHaveBeenCalledTimes(1)
    const { KEYBINDINGS } = await import('../../../src/keyboard/keybindings')
    expect(KEYBINDINGS.filter(binding => (binding.chords as readonly string[]).includes('Mod+K')).map(binding => binding.id as string)).toEqual(['commandBar.open'])
  })

  test('empty, the bar shows the four hints, and the combobox is not expanded', async () => {
    const { input } = await renderBar()
    for (const hint of ['start or delegate', 'run a skill', 'go anywhere', 'every command and its shortcut']) expect(screen.getByText(hint)).toBeInTheDocument()
    for (const example of ['@Codex write tests for the Pix webhook', '/skill pix-rules', 'open billing-staging', '?']) expect(screen.getByText(example)).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  test('with results the combobox is expanded over labelled groups, the active option is its descendant, and options are not tabbable', async () => {
    const { input } = await renderBar()
    await userEvent.type(input, '?')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const active = input.getAttribute('aria-activedescendant')
    expect(active && document.getElementById(active)?.getAttribute('role')).toBe('option')
    const listbox = screen.getByRole('listbox')
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
    const groups = within(listbox).getAllByRole('group')
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) expect(group.getAttribute('aria-label') ?? group.getAttribute('aria-labelledby')).toBeTruthy()
    for (const option of options()) expect(option.tabIndex).toBeLessThan(0)
  })

  test('the count is announced politely after a 300 ms pause, and no match says so', async () => {
    const { input } = await renderBar()
    await userEvent.type(input, '/sk')
    const status = await screen.findByText(/^\d+ results?$/, undefined, { timeout: 2_000 })
    expect(status.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
    await userEvent.clear(input)
    await userEvent.type(input, 'zzqq')
    expect(screen.queryByText('No match for zzqq')).toBeNull()
    expect(await screen.findByText('No match for zzqq', undefined, { timeout: 2_000 })).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
  })

  test('every command result shows "Also:" its button, and its shortcut', async () => {
    const { input } = await renderBar()
    await userEvent.type(input, '?')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    const { COMMAND_CATALOG } = await load<{ COMMAND_CATALOG: ReadonlyArray<{ id: string; fallback: string; shortcut: string | null }> }>('shared/command-bar')
    expect(options().length).toBeGreaterThanOrEqual(COMMAND_CATALOG.length)
    for (const option of options()) expect(option.textContent).toMatch(/Also: /)
  })

  test('/skill lists the skills with their descriptions, and Enter runs one through skill.invoke in the agent pane', async () => {
    const { input, skill, onRun } = await renderBar()
    await userEvent.type(input, '/skill ')
    expect(await screen.findByText('Checks a change against the Pix rules')).toBeInTheDocument()
    expect(screen.getByText('Writes the release notes')).toBeInTheDocument()
    await userEvent.type(input, 'pix-rules{Enter}')
    await waitFor(() => expect(skill.invoke).toHaveBeenCalledWith({ skillName: 'pix-rules', paneId: 'p-A', argument: '' }))
    expect(onRun).not.toHaveBeenCalled()
  })

  test('a skill not enabled here is refused as a result row, never a toast, and nothing runs', async () => {
    const { input, skill } = await renderBar({ ...CONTEXT, enabledSkills: ['release-notes'] })
    await userEvent.type(input, '/skill pix-rules{Enter}')
    expect(await screen.findByText("/pix-rules isn't enabled in this project.")).toBeInTheDocument()
    expect(screen.getByRole('listbox').textContent).toContain("/pix-rules isn't enabled in this project.")
    expect(skill.invoke).not.toHaveBeenCalled()
  })

  test('/approve is no command: the bar says so and offers nothing that approves', async () => {
    const { input, onRun } = await renderBar()
    await userEvent.type(input, '/approve')
    expect(await screen.findByText('No command /approve')).toBeInTheDocument()
    expect(options().filter(option => /approve|allow/i.test(option.textContent ?? ''))).toEqual([])
    await userEvent.keyboard('{Enter}')
    expect(onRun).not.toHaveBeenCalled()
  })

  test("/deny declines the focused workspace's request through thread.respond, never an approval", async () => {
    const { input, thread } = await renderBar()
    await userEvent.type(input, '/deny')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(thread.respond).toHaveBeenCalledWith('t-A', 'r-A1', { decision: 'decline' }))
    expect(thread.respond).toHaveBeenCalledTimes(1)
  })

  test("/deny of another workspace's request names that workspace with Open it, and nothing is answered", async () => {
    const { input, thread } = await renderBar()
    await userEvent.type(input, '/deny r-B1{Enter}')
    expect(await screen.findByText('That request is in payments.')).toBeInTheDocument()
    expect(screen.getByText('Open payments')).toBeInTheDocument()
    expect(thread.respond).not.toHaveBeenCalled()
  })

  test('/deny with nothing waiting says so, and nothing is answered', async () => {
    const { input, thread } = await renderBar({ ...CONTEXT, requests: [] })
    await userEvent.type(input, '/deny{Enter}')
    expect(await screen.findByText('Nothing is waiting for you.')).toBeInTheDocument()
    expect(thread.respond).not.toHaveBeenCalled()
  })

  test('@Codex runs as an agent command with its text', async () => {
    const { input, onRun } = await renderBar()
    await userEvent.type(input, '@Codex write tests for the Pix webhook')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    await userEvent.keyboard('{Enter}')
    expect(onRun).toHaveBeenCalledWith({ kind: 'agent', provider: 'codex', text: 'write tests for the Pix webhook' })
  })

  test('open ranks an exact title first, then a leading match, then the rest', async () => {
    const { input } = await renderBar()
    await userEvent.type(input, 'open billing')
    await waitFor(() => expect(options().length).toBeGreaterThanOrEqual(3))
    const names = options().map(option => (option.textContent ?? '').match(/old-billing|billing-staging|billing/)?.[0]).filter(Boolean)
    expect(names.slice(0, 3)).toEqual(['billing', 'billing-staging', 'old-billing'])
  })

  test('the command bar reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    const { input } = await renderBar()
    for (const hint of ['começar ou delegar', 'rodar uma skill', 'ir a qualquer lugar', 'todos os comandos e atalhos']) expect(screen.getByText(hint)).toBeInTheDocument()
    await userEvent.type(input, 'zzqq')
    expect(await screen.findByText('Nada encontrado para zzqq', undefined, { timeout: 2_000 })).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.type(input, '?')
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    for (const option of options()) expect(option.textContent).toMatch(/Também: /)
  })

  test('a skill with no agent pane focused asks to focus one first, and nothing runs', async () => {
    const { input, skill } = await renderBar({ ...CONTEXT, pane: { id: 'p-shell', agent: false } })
    await userEvent.type(input, '/skill pix-rules{Enter}')
    expect(await screen.findByText('Focus a conversation or an agent pane first.')).toBeInTheDocument()
    expect(skill.invoke).not.toHaveBeenCalled()
  })

  test('text with a control character is refused with its line, and nothing runs', async () => {
    const { input, skill } = await renderBar()
    fireEvent.change(input, { target: { value: '/skill pix-rules x\u0003' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('Remove the control characters from the text.')).toBeInTheDocument()
    expect(skill.invoke).not.toHaveBeenCalled()
  })

})
