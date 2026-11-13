// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import '../src/i18n'
import { SchedulesDialog } from '../src/components/Schedules/SchedulesDialog'
import { useThreadStore } from '../src/store/thread.store'
import type { Schedule, ScheduleInput, ScheduleRun, SchedulesState } from '../shared/schedule'

const project = { projectId: 'p1', displayName: 'shop-api', identityLabel: 'shop-api', hidden: false, contexts: [{ rootPath: 'C:/work/shop', label: 'shop' }] }
const schedule = (over: Partial<Schedule> = {}): Schedule => ({ id: 's1', name: 'Morning review', projectId: 'p1', rootPath: 'C:/work/shop', provider: 'claude', model: null, access: 'read-only', prompt: 'Review what changed.', rule: { kind: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] }, enabled: true, catchUp: false, createdAt: 1, updatedAt: 1, nextRunAt: new Date(2030, 0, 7, 9, 0).getTime(), lastRunAt: null, failures: 0, pausedReason: null, ...over })

function mockApi(initial: SchedulesState, runs: Record<string, ScheduleRun[]> = {}) {
  let state = initial
  const api = {
    state: vi.fn(async () => state), runs: vi.fn(async (id: string) => runs[id] ?? []),
    save: vi.fn(async (input: ScheduleInput) => { const saved = schedule({ id: input.id ?? 'new', name: input.name, access: input.access, rule: input.rule }); state = { ...state, schedules: [...state.schedules.filter(each => each.id !== saved.id), saved] }; return { ok: true as const, value: saved } }),
    remove: vi.fn(async (id: string) => { state = { ...state, schedules: state.schedules.filter(each => each.id !== id) } }),
    setEnabled: vi.fn(async () => ({ ok: true as const, value: undefined })), setPaused: vi.fn(async (paused: boolean) => { state = { ...state, paused } }),
    runNow: vi.fn(async () => ({ ok: true as const, value: { id: 'r9', scheduleId: 's1', dueAt: 1, at: 2, outcome: 'started' as const, threadId: 't9', detail: null } })), onChanged: vi.fn(() => () => undefined)
  }
  Object.assign(window, { oxe: { schedules: api } })
  return api
}

beforeEach(() => { useThreadStore.setState({ projects: [project], loadProjects: async () => undefined } as never) })
afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

describe('the Schedules dialog', () => {
  test('with none yet it says what a schedule is and offers a new one', async () => {
    mockApi({ paused: false, schedules: [] })
    render(<SchedulesDialog onClose={() => undefined} onOpenThread={() => undefined} />)
    expect(await screen.findByText('No schedules yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New schedule' })).toBeEnabled()
    expect(screen.getByText(/never run with full access or without approvals/)).toBeInTheDocument()
  })

  test('a schedule reads as when, who, where and with what access, with its next time and how the last run went', async () => {
    const onOpenThread = vi.fn(), onClose = vi.fn()
    mockApi({ paused: false, schedules: [schedule()] }, { s1: [{ id: 'r1', scheduleId: 's1', dueAt: 1, at: new Date(2030, 0, 4, 9, 0).getTime(), outcome: 'started', threadId: 't1', detail: null }] })
    render(<SchedulesDialog onClose={onClose} onOpenThread={onOpenThread} />)
    const row = await screen.findByTestId('schedule-row')
    expect(row).toHaveTextContent('Morning review')
    expect(row).toHaveTextContent(/Weekdays at 0?9:00( AM)? · Claude · shop-api · Read only/)
    // The date reads in the system's own order (7 Jan or Jan 7): what matters is which day and that both are there.
    expect(row).toHaveTextContent(/Next: [^·]*Jan[^·]*/)
    expect(row.textContent).toMatch(/Next: [^·]*\b7\b/)
    await waitFor(() => expect(row).toHaveTextContent(/Last: [^·]*Jan[^·]*, started/))
    fireEvent.click(within(row).getByRole('button', { name: 'Open conversation' }))
    expect(onOpenThread).toHaveBeenCalledWith('t1')
    expect(onClose).toHaveBeenCalled()
  })

  test('the form says what is missing, shows the first run, and saves what was filled in', async () => {
    const api = mockApi({ paused: false, schedules: [] })
    render(<SchedulesDialog onClose={() => undefined} onOpenThread={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New schedule' }))
    const form = await screen.findByTestId('schedule-form')
    const save = within(form).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Nightly notes' } })
    fireEvent.change(within(form).getByLabelText('Request'), { target: { value: 'Write the notes.' } })
    expect(within(form).getByTestId('schedule-preview')).toHaveTextContent(/First run: .* · Claude · Read only · shop-api/)
    fireEvent.click(within(form).getByRole('radio', { name: 'Every few hours' }))
    fireEvent.change(within(form).getByLabelText('Every (hours)'), { target: { value: '0' } })
    expect(within(form).getByText('Choose a whole number of hours, from 1 to 24.')).toBeInTheDocument()
    expect(save).toBeDisabled()
    fireEvent.change(within(form).getByLabelText('Every (hours)'), { target: { value: '6' } })
    fireEvent.click(save)
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    expect(api.save.mock.calls[0][0]).toMatchObject({ name: 'Nightly notes', prompt: 'Write the notes.', projectId: 'p1', rootPath: 'C:/work/shop', provider: 'claude', access: 'read-only', catchUp: false, rule: { kind: 'hours', every: 6 } })
    expect(api.save.mock.calls[0][0].confirmedWrite).toBeUndefined()
    expect(await screen.findByTestId('schedule-row')).toHaveTextContent('Nightly notes')
  })

  test('a schedule that can edit files is saved only after the person ticks and confirms', async () => {
    const api = mockApi({ paused: false, schedules: [] })
    render(<SchedulesDialog onClose={() => undefined} onOpenThread={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New schedule' }))
    const form = await screen.findByTestId('schedule-form')
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Fix lint' } })
    fireEvent.change(within(form).getByLabelText('Request'), { target: { value: 'Fix the lint errors.' } })
    fireEvent.change(within(form).getByLabelText('Access'), { target: { value: 'workspace-write' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))
    const confirm = await screen.findByTestId('schedule-confirm-write')
    expect(api.save).not.toHaveBeenCalled()
    expect(confirm).toHaveTextContent('"Fix lint" will run Claude in shop-api with permission to edit files')
    const yes = within(confirm).getByRole('button', { name: 'Save schedule' })
    expect(yes).toBeDisabled()
    fireEvent.click(within(confirm).getByRole('checkbox'))
    fireEvent.click(yes)
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1))
    expect(api.save.mock.calls[0][0]).toMatchObject({ access: 'workspace-write', confirmedWrite: true })
  })

  test('"Full access" is not among the choices', async () => {
    mockApi({ paused: false, schedules: [] })
    render(<SchedulesDialog onClose={() => undefined} onOpenThread={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New schedule' }))
    const options = [...(within(await screen.findByTestId('schedule-form')).getByLabelText('Access') as HTMLSelectElement).options].map(option => option.textContent)
    expect(options).toEqual(['Read only', 'Can edit'])
  })

  test('pause all, run now, turn off and delete go to main; a schedule OXESpace stopped says why', async () => {
    const api = mockApi({ paused: false, schedules: [schedule({ enabled: false, pausedReason: 'failures', failures: 3, nextRunAt: null })] })
    render(<SchedulesDialog onClose={() => undefined} onOpenThread={() => undefined} />)
    const row = await screen.findByTestId('schedule-row')
    expect(row).toHaveTextContent('Stopped by OXESpace')
    expect(row).toHaveTextContent('It could not start 3 times in a row')
    expect(row).toHaveTextContent('Not scheduled')
    fireEvent.click(within(row).getByRole('switch', { name: 'Run Morning review on schedule' }))
    await waitFor(() => expect(api.setEnabled).toHaveBeenCalledWith({ id: 's1', enabled: true }))
    fireEvent.click(within(row).getByRole('button', { name: 'Run Morning review now' }))
    await waitFor(() => expect(api.runNow).toHaveBeenCalledWith('s1'))
    fireEvent.click(screen.getByRole('switch', { name: /Pause all/ }))
    await waitFor(() => expect(api.setPaused).toHaveBeenCalledWith(true))
    expect(await screen.findByText(/All schedules are paused/)).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('schedule-row')).getByRole('button', { name: 'Delete Morning review' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete schedule' }))
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('s1'))
    await waitFor(() => expect(screen.queryByTestId('schedule-row')).toBeNull())
  })
})
