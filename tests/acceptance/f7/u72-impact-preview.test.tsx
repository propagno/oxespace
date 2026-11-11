// Frozen acceptance test for 1.5.0 A25, A27 and A28's desktop line on screen (DESIGN U7.2, OXE program, phase F7, task
// FE-AP2). Written by the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f7-design.md (U7.2).
// Contract (BACKEND #714 §Contract): ThreadRequest.impact (see u71); window.oxe.approvals.preview(requestId) →
// { status: 'ok' | 'off-production' | 'failed', count: number | null, sample?: { cols, rows }, reason? }, where a changed
// cell is { old, new }. The renderer part: ImpactPreview({ request, agent, conversation, onRespond, onClose }) in
// src/components/Approvals/ImpactPreview.tsx, a U1 lg dialog; it asks for the preview only for a database write.
// TECH LEAD's update (08/11, HML-F7-1): critical takes the 1.2 s hold; high and irreversible (a non-production database
// write) a one-click danger Approve with the No undo callout; reversible a primary Approve. U7.2d (themes, 900 × 620, axe) is the e2e/visual run.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Props = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

const DB_WRITE = { why: 'Marks the paid orders.', where: 'shop', whereSub: 'dev', affects: { count: 42, unit: 'rows' }, reversible: false, risk: 'high', kind: 'db', text: "UPDATE orders SET status = 'paid' WHERE customer_id = 7", lang: 'sql' }
const PUSH = { why: 'Publishes the package.', where: 'shop', affects: { count: 1, unit: 'resources' }, reversible: false, risk: 'critical', kind: 'push', text: 'npm publish', lang: 'shell' }
const EDIT = { why: 'Fixes the total.', where: 'shop', affects: { count: 2, unit: 'files' }, reversible: true, undoHow: 'checkpoint', risk: 'low', kind: 'file', text: 'apply_patch src/a.ts', lang: 'diff' }
const request = (impact: Props) => ({
  id: 'r1', nativeId: 'n-1', nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Update 42 orders', toolName: 'Bash', command: impact.text,
  generation: 1, createdAt: 1, state: 'pending', availableDecisions: ['accept', 'decline'], impact
})
function mockPreview(result: Props) {
  const approvals = { preview: vi.fn(async () => result) }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, approvals } })
  return approvals
}
async function renderPreview(impact: Props) {
  const { ImpactPreview } = await load<{ ImpactPreview: (props: Props) => JSX.Element }>('src/components/Approvals/ImpactPreview')
  const { Toaster } = await import('../../../src/ui/Toast')
  const onRespond = vi.fn(async () => undefined)
  render(<><ImpactPreview request={request(impact)} agent="Claude" conversation="Checkout" onRespond={onRespond} onClose={vi.fn()} /><Toaster /></>)
  return onRespond
}
const SAMPLE = { status: 'ok', count: 42, sample: { cols: ['id', 'status'], rows: [[1, { old: 'open', new: 'paid' }], [2, { old: 'open', new: 'paid' }], [3, { old: 'open', new: 'paid' }], [4, { old: 'open', new: 'paid' }], [5, { old: 'open', new: 'paid' }]] } }

afterEach(async () => { cleanup(); vi.useRealTimers(); await changeLanguage('en') })

describe('U7.2 · The impact preview', () => {
  test('the dialog shows the agent and conversation, the why, the four facts and exactly what runs, with Deny focused', async () => {
    mockPreview(SAMPLE)
    await renderPreview(PUSH)
    const dialog = await screen.findByRole('dialog', { name: /Update 42 orders/ })
    expect(within(dialog).getByText('Claude · Checkout')).toBeInTheDocument()
    expect(within(dialog).getByText('Publishes the package.')).toBeInTheDocument()
    for (const label of ['Where it runs', 'Affects', 'Can it be undone?', 'Risk']) expect(within(dialog).getByText(label)).toBeInTheDocument()
    expect(within(dialog).getByText('npm publish')).toBeInTheDocument()
    expect(within(dialog).getByText(/exactly what runs/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^Deny/ })).toHaveFocus()
  })

  test('a database write shows the SELECT sample with old → new and the count, and asks main only for the preview', async () => {
    const approvals = mockPreview(SAMPLE)
    await renderPreview(DB_WRITE)
    expect(await screen.findByText('Before → after')).toBeInTheDocument()
    expect(screen.getByText('5 of 42 rows, read with SELECT')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    expect(within(table).getAllByText(/open\s*→\s*paid/)).toHaveLength(5)
    expect(approvals.preview).toHaveBeenCalledWith('r1')
    expect(Object.keys(approvals)).toEqual(['preview'])
  })

  test('a file change or a command asks for no database preview', async () => {
    const approvals = mockPreview(SAMPLE)
    await renderPreview(PUSH)
    await screen.findByRole('dialog')
    expect(approvals.preview).not.toHaveBeenCalled()
    expect(screen.queryByText('Before → after')).toBeNull()
  })

  test('production: the preview is off, and the count shows only when the policy allows it', async () => {
    mockPreview({ status: 'off-production', count: null })
    await renderPreview(DB_WRITE)
    expect(await screen.findByText('Preview is off for production.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText(/\b42 rows\b/)).toBeNull()
    cleanup()
    mockPreview({ status: 'off-production', count: 42 })
    await renderPreview(DB_WRITE)
    expect(await screen.findByText('Preview is off for production.')).toBeInTheDocument()
    expect(screen.getByText(/42 rows/)).toBeInTheDocument()
  })

  test("a failed preview says why and that nothing ran", async () => {
    mockPreview({ status: 'failed', count: null, reason: 'multiple statements' })
    await renderPreview(DB_WRITE)
    expect(await screen.findByText("Couldn't preview: multiple statements. Nothing ran.")).toBeInTheDocument()
  })

  test("critical: one danger callout to hold Approve, the Critical risk fact and the phone line, and no plain Approve", async () => {
    mockPreview(SAMPLE)
    await renderPreview(PUSH)
    expect(await screen.findByText(/This can't be undone\./)).toBeInTheDocument()
    expect(screen.getByText(/Hold Approve for 1\.2 s to confirm\./)).toBeInTheDocument()
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.getByText('On the phone this is Critical: Allow unlocks after 2 s.')).toBeInTheDocument()
    expect(screen.queryByText(/No undo\./)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Approve A?$/ })).toBeNull()
  })

  test('high and irreversible (a dev database write): the No undo warning, High, the computer-only line, and a one-click Approve with no hold or Undo', async () => {
    mockPreview(SAMPLE)
    const onRespond = await renderPreview(DB_WRITE)
    expect(await screen.findByText(/No undo\./)).toBeInTheDocument()
    expect(screen.getByText(/OXESpace can't revert this, so Deny if you're unsure\./)).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.queryByText(/This can't be undone/)).toBeNull()
    expect(screen.getByText('Database writes are answered only at this computer.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hold to approve/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve without holding…' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Deny/ })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: /^Approve/ }))
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith({ decision: 'accept' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  test('an unknown count reads Not known, with the unit hidden', async () => {
    mockPreview(SAMPLE)
    await renderPreview({ ...PUSH, affects: { count: null, unit: 'resources' } })
    expect(await screen.findByText('Not known')).toBeInTheDocument()
    expect(screen.queryByText(/resources/)).toBeNull()
  })

  test('reversible: one success callout with the undo way, and a primary Approve in one step', async () => {
    mockPreview(SAMPLE)
    const onRespond = await renderPreview(EDIT)
    expect(await screen.findByText(/if you change your mind\./)).toBeInTheDocument()
    expect(screen.queryByText(/This can't be undone/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Hold to approve/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Approve/ }))
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith({ decision: 'accept' })
  })

  test('the hold completes at 1.2 s with the pointer; a release at 1.1 s does nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    mockPreview(SAMPLE)
    const onRespond = await renderPreview(PUSH)
    const hold = screen.getByRole('button', { name: /Hold to approve/ })
    act(() => { fireEvent.pointerDown(hold, { pointerId: 1, button: 0 }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100) })
    act(() => { fireEvent.pointerUp(hold, { pointerId: 1, button: 0 }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(onRespond).not.toHaveBeenCalled()
    act(() => { fireEvent.pointerDown(hold, { pointerId: 1, button: 0 }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_250) })
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith({ decision: 'accept' })
  })

  test.each([[' ', 'Space'], ['Enter', 'Enter'], ['a', 'A']])('holding %s on the hold button for 1.2 s approves; a short press does nothing (%s)', async (key) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    mockPreview(SAMPLE)
    const onRespond = await renderPreview(PUSH)
    const hold = screen.getByRole('button', { name: /Hold to approve/ })
    act(() => { hold.focus(); fireEvent.keyDown(hold, { key }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    act(() => { fireEvent.keyUp(hold, { key }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000) })
    expect(onRespond).not.toHaveBeenCalled()
    act(() => { fireEvent.keyDown(hold, { key }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1_250) })
    expect(onRespond).toHaveBeenCalledWith({ decision: 'accept' })
  })

  test('Approve without holding needs the checkbox, Cancel is focused, and no Undo follows', async () => {
    mockPreview(SAMPLE)
    const onRespond = await renderPreview(PUSH)
    await userEvent.click(screen.getByRole('button', { name: 'Approve without holding…' }))
    const confirm = await screen.findByRole('dialog', { name: /Approve without holding/ })
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    const approve = within(confirm).getAllByRole('button').find(button => /^Approve/.test(button.textContent?.trim() ?? ''))!
    expect(approve).toBeDisabled()
    await userEvent.click(within(confirm).getByRole('checkbox', { name: "I understand this can't be undone" }))
    expect(approve).toBeEnabled()
    await userEvent.click(approve)
    expect(onRespond).toHaveBeenCalledWith({ decision: 'accept' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  test('Deny in the preview is one step', async () => {
    mockPreview(SAMPLE)
    const onRespond = await renderPreview(PUSH)
    await userEvent.click(await screen.findByRole('button', { name: /^Deny/ }))
    expect(onRespond).toHaveBeenCalledTimes(1)
    expect(onRespond).toHaveBeenCalledWith({ decision: 'decline' })
  })

  test('the preview reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    mockPreview(SAMPLE)
    await renderPreview(DB_WRITE)
    expect(await screen.findByText('Antes → depois')).toBeInTheDocument()
    expect(screen.getByText('5 de 42 linhas, lidas com SELECT')).toBeInTheDocument()
    for (const label of ['Onde roda', 'Afeta', 'Dá para desfazer?', 'Risco']) expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText(/Sem desfazer\./)).toBeInTheDocument()
    expect(screen.getByText(/O OXESpace não consegue reverter isto; negue se tiver dúvida\./)).toBeInTheDocument()
    expect(screen.getByText('Alto')).toBeInTheDocument()
    expect(screen.getByText('Escritas em banco são respondidas só neste computador.')).toBeInTheDocument()
    cleanup()
    mockPreview(SAMPLE)
    await renderPreview(PUSH)
    expect(await screen.findByText(/Isto não pode ser desfeito\./)).toBeInTheDocument()
    expect(screen.getByText('Crítico')).toBeInTheDocument()
    expect(screen.getByText('No celular é Crítico: Permitir libera depois de 2 s.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Segure para aprovar/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aprovar sem segurar…' })).toBeInTheDocument()
  })

  test('under reduced motion the hold shows a static countdown text and still completes at 1.2 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'] })
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(query), media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia
    try {
      mockPreview(SAMPLE)
      const onRespond = await renderPreview(PUSH)
      const hold = screen.getByRole('button', { name: /Hold to approve/ })
      act(() => { fireEvent.pointerDown(hold, { pointerId: 1, button: 0 }) })
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
      expect(within(hold.parentElement ?? hold).getByText(/\d[.,]\d\s?s/)).toBeInTheDocument()
      await act(async () => { await vi.advanceTimersByTimeAsync(850) })
      expect(onRespond).toHaveBeenCalledWith({ decision: 'accept' })
    } finally { window.matchMedia = original }
  })

})
