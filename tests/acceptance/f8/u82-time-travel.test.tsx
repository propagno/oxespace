// Frozen acceptance test for 1.5.0 A30 on screen (DESIGN U8.2, OXE program, phase F8, task FE-A30). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f8-design.md (U8.2).
// Contract (BACKEND #717 §A30): window.oxe.thread.timeline(threadId) → { checkpoints[{ id, n, at, label, files, checkout,
// failed?, turnId }], cantGoBack { dbWrites, pushes, containers }, canBranch, branchRefusal? } (turnId, canBranch and
// branchRefusal are FRONTEND's adds on #717); Restore is today's thread.rewind(threadId, turnId, { restoreFiles });
// thread.branchFromCheckpoint(threadId, checkpointId, { branch }) → { ok: true, threadId, workspaceId, worktreePath } |
// { ok: false, refusal: { code, params } }; branchNameFor(title, at) from shared/branch-name prefills the name.
// The renderer part: TimeTravelBar({ threadId, title, agent, onBranched(result), onClose() }) in
// src/components/Threads/TimeTravelBar.tsx; the knob is the track's only control (role slider); Ctrl H is thread.history.
// U8.2c's "Branch selects the new card in ≤ 4 steps" is HML's walk; the redo itself is today's rewind (unchanged).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Row = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

const at = (hour: number, minute: number) => new Date(2026, 10, 8, hour, minute).getTime()
// "14:03" in a 24-hour locale, "2:03 PM" in a 12-hour one: the clock is the locale's, the minute is the checkpoint's.
const clock = (hour: number, minute: number) => new RegExp(`(${hour}:${String(minute).padStart(2, '0')}|${hour % 12 || 12}:${String(minute).padStart(2, '0')}\\s?[AP]M)`)
const TIMELINE = {
  checkpoints: [
    { id: 'cp-1', n: 1, at: at(14, 3), label: 'Add the Pix webhook', files: ['src/pix.ts', 'src/routes.ts'], checkout: '/repo/shop', turnId: 'turn-1' },
    { id: 'cp-2', n: 2, at: at(14, 20), label: 'Write its tests', files: ['tests/pix.test.ts'], checkout: '/repo/shop', turnId: 'turn-2' },
    { id: 'cp-3', n: 3, at: at(14, 41), label: 'Fix the signature', files: ['src/pix.ts', 'src/sign.ts', 'src/env.ts'], checkout: '/repo/shop', turnId: 'turn-3' }
  ],
  cantGoBack: { dbWrites: 1, pushes: 1, containers: 0 },
  canBranch: true
}
function mockMain(timeline: Row = TIMELINE, branch: Row = { ok: true, threadId: 't-new', workspaceId: 'ws-new', worktreePath: '/repo/shop-from-1403' }) {
  const thread = {
    timeline: vi.fn(async () => timeline),
    rewind: vi.fn(async () => ({ ok: true })),
    branchFromCheckpoint: vi.fn(async () => branch)
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread } })
  return thread
}
async function renderBar() {
  const { TimeTravelBar } = await load<{ TimeTravelBar: (props: Row) => JSX.Element }>('src/components/Threads/TimeTravelBar')
  const props = { threadId: 't-1', title: 'Pix webhook', agent: 'Claude', onBranched: vi.fn(), onClose: vi.fn() }
  render(<TimeTravelBar {...props} />)
  const knob = await screen.findByRole('slider')
  return { ...props, knob }
}
const press = (knob: HTMLElement, key: string) => { knob.focus(); fireEvent.keyDown(knob, { key }) }
const restore = () => screen.getByRole('button', { name: /^Restore to/ })
const branch = () => screen.getByRole('button', { name: /^Branch into a new worktree/ })

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('U8.2 · Time travel', () => {
  test('Ctrl H opens History, and no other shortcut takes the chord', async () => {
    const { KEYBINDINGS } = await import('../../../src/keyboard/keybindings')
    expect(KEYBINDINGS.filter(binding => (binding.chords as readonly string[]).includes('Mod+H')).map(binding => binding.id as string)).toEqual(['thread.history'])
  })

  test('the bar opens at the latest checkpoint with its files, and the knob is the only control in the track', async () => {
    const thread = mockMain()
    const { knob } = await renderBar()
    expect(thread.timeline).toHaveBeenCalledWith('t-1')
    expect(await screen.findByText(new RegExp(`^3 files at ${clock(14, 41).source}$`))).toBeInTheDocument()
    for (const file of ['src/pix.ts', 'src/sign.ts', 'src/env.ts']) expect(screen.getByText(file)).toBeInTheDocument()
    const track = knob.closest('[data-track], [role="group"]') as HTMLElement ?? knob.parentElement!
    const focusable = [...track.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]')].filter(element => element.tabIndex >= 0)
    expect(focusable).toEqual([knob])
  })

  test('the keys move exactly as listed: Home, End, ← → one step, [ ] one checkpoint', async () => {
    mockMain()
    const { knob } = await renderBar()
    await screen.findByText(/^3 files at /)
    press(knob, 'Home')
    expect(await screen.findByText(new RegExp(`^2 files at ${clock(14, 3).source}$`))).toBeInTheDocument()
    press(knob, 'ArrowRight')
    expect(await screen.findByText('Transcript only between checkpoints')).toBeInTheDocument()
    press(knob, 'ArrowRight')
    expect(await screen.findByText(new RegExp(`^1 file at ${clock(14, 20).source}$`))).toBeInTheDocument()
    press(knob, 'ArrowLeft')
    expect(await screen.findByText('Transcript only between checkpoints')).toBeInTheDocument()
    press(knob, ']')
    expect(await screen.findByText(/^1 file at /)).toBeInTheDocument()
    press(knob, ']')
    expect(await screen.findByText(/^3 files at /)).toBeInTheDocument()
    press(knob, '[')
    expect(await screen.findByText(/^1 file at /)).toBeInTheDocument()
    press(knob, 'End')
    expect(await screen.findByText(/^3 files at /)).toBeInTheDocument()
  })

  test('between checkpoints both buttons are disabled with the reason', async () => {
    mockMain()
    const { knob } = await renderBar()
    await screen.findByText(/^3 files at /)
    press(knob, 'Home')
    press(knob, 'ArrowRight')
    await screen.findByText('Transcript only between checkpoints')
    expect(restore()).toBeDisabled()
    expect(branch()).toBeDisabled()
    for (const button of [restore(), branch()]) expect(button.getAttribute('title') ?? button.getAttribute('aria-description') ?? document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toMatch(/Transcript only between checkpoints/)
  })

  test("the can't-go-back note is always there with the audits' counts, and it cannot be dismissed", async () => {
    mockMain()
    const { knob } = await renderBar()
    const note = await screen.findByText(/^Can't go back, at least: 1 database writes?, 1 push(es)?, 0 containers\.$/)
    expect(note.closest('[role="note"], p, div')!.querySelector('button')).toBeNull()
    press(knob, 'Home')
    expect(screen.getByText(/^Can't go back, at least:/)).toBeInTheDocument()
  })

  test('later steps sit in the "Set aside if you restore here" band', async () => {
    mockMain()
    const { knob } = await renderBar()
    await screen.findByText(/^3 files at /)
    expect(screen.queryByRole('region', { name: 'Set aside if you restore here' })).toBeNull()
    press(knob, 'Home')
    const band = await screen.findByRole('region', { name: 'Set aside if you restore here' })
    expect(within(band).getByText('Write its tests')).toBeInTheDocument()
    expect(within(band).getByText('Fix the signature')).toBeInTheDocument()
    expect(within(band).queryByText('Add the Pix webhook')).toBeNull()
  })

  test('Restore asks first with files restored by default and Cancel focused, then rewinds to that turn', async () => {
    const thread = mockMain()
    const { knob } = await renderBar()
    await screen.findByText(/^3 files at /)
    press(knob, 'Home')
    await userEvent.click(restore())
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/^Restore to .+\? Later messages are set aside; Redo works until your next message\.$/)).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox', { name: 'Also restore files' })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }))
    expect(thread.rewind).toHaveBeenCalledWith('t-1', 'turn-1', { restoreFiles: true })
  })

  test('Branch prefills the safe name, says the agent continues there, and opens the new conversation', async () => {
    const thread = mockMain()
    const props = await renderBar()
    await screen.findByText(/^3 files at /)
    press(props.knob, 'Home')
    await userEvent.click(branch())
    const dialog = await screen.findByRole('dialog')
    const { branchNameFor } = await load<{ branchNameFor: (title: string, at: number) => string }>('shared/branch-name')
    const name = within(dialog).getByRole('textbox')
    expect(name).toHaveValue(branchNameFor('Pix webhook', at(14, 3)))
    expect(within(dialog).getByText('Claude continues from that moment in the new worktree.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Branch' }))
    expect(thread.branchFromCheckpoint).toHaveBeenCalledWith('t-1', 'cp-1', { branch: branchNameFor('Pix webhook', at(14, 3)) })
    await waitFor(() => expect(props.onBranched).toHaveBeenCalledWith(expect.objectContaining({ ok: true, threadId: 't-new', workspaceId: 'ws-new' })))
  })

  test('a refused branch says why and opens nothing', async () => {
    mockMain(TIMELINE, { ok: false, refusal: { code: 'thread.branch.exists', params: { branch: 'oxe/pix' } } })
    const props = await renderBar()
    await screen.findByText(/^3 files at /)
    await userEvent.click(branch())
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Branch' }))
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert')).toBeInTheDocument())
    expect(props.onBranched).not.toHaveBeenCalled()
  })

  test("a failed checkpoint is transcript only, with Restore and Branch disabled", async () => {
    mockMain({ ...TIMELINE, checkpoints: [TIMELINE.checkpoints[0], { ...TIMELINE.checkpoints[1], failed: true }, TIMELINE.checkpoints[2]] })
    const { knob } = await renderBar()
    await screen.findByText(/^3 files at /)
    press(knob, '[')
    expect(await screen.findByText("Transcript only: this checkpoint's files weren't saved.")).toBeInTheDocument()
    expect(restore()).toBeDisabled()
    expect(branch()).toBeDisabled()
  })

  test('a conversation that cannot branch shows Branch disabled up front, with Not available in Codex', async () => {
    const thread = mockMain({ ...TIMELINE, canBranch: false, branchRefusal: { code: 'thread.branch.unsupported', params: { provider: 'codex' } } })
    await renderBar()
    await screen.findByText(/^3 files at /)
    expect(branch()).toBeDisabled()
    expect(screen.getByText('Not available in Codex')).toBeInTheDocument()
    expect(restore()).toBeEnabled()
    expect(thread.branchFromCheckpoint).not.toHaveBeenCalled()
  })

  test('time travel reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    mockMain()
    const { knob } = await renderBar()
    expect(await screen.findByText(/^3 arquivos às /)).toBeInTheDocument()
    expect(screen.getByText(/^Não dá para voltar, pelo menos: 1 escritas? em banco, 1 push(es)?, 0 contêineres\.$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Restaurar para/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Ramificar numa nova worktree/ })).toBeInTheDocument()
    press(knob, 'Home')
    press(knob, 'ArrowRight')
    expect(await screen.findByText('Só a conversa entre checkpoints')).toBeInTheDocument()
  })
})
