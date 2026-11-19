import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SchedulesDialog } from '../../../src/components/Schedules/SchedulesDialog'
import { useThreadStore } from '../../../src/store/thread.store'

const PROJECT = {
  projectId: 'p1',
  displayName: 'shop-api',
  identityLabel: 'shop-api',
  hidden: false,
  contexts: [{ rootPath: 'C:/work/shop', label: 'shop' }]
}

beforeEach(() => {
  useThreadStore.setState({ projects: [PROJECT], loadProjects: async () => undefined } as never)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as { oxe?: unknown }).oxe
})

describe('OXE-269 · PP-05.14 SchedulesDialog active border, flexible date column and LoadingState', () => {
  test('[css] active schedule frequency and day buttons use --accent-border and keep aria-checked/aria-pressed', async () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/Schedules/Schedules.module.css'), 'utf8')
    expect(css).toMatch(/\.kindOn\s*\{[^}]*background\s*:\s*var\(--fill-selected\)[^}]*border-color\s*:\s*var\(--accent-border\)/)

    Object.assign(window, {
      oxe: {
        schedules: {
          state: vi.fn(async () => ({ paused: false, schedules: [] })),
          runs: vi.fn(async () => []),
          onChanged: vi.fn(() => () => undefined)
        }
      }
    })

    render(<SchedulesDialog onClose={() => undefined} onOpenThread={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New schedule' }))
    const form = await screen.findByTestId('schedule-form')

    const dailyRadio = within(form).getByRole('radio', { name: 'On days at a time' })
    const hoursRadio = within(form).getByRole('radio', { name: 'Every few hours' })
    expect(dailyRadio).toHaveAttribute('aria-checked', 'true')
    expect(hoursRadio).toHaveAttribute('aria-checked', 'false')

    const dayButtons = within(within(form).getByRole('group', { name: 'Days of the week' })).getAllByRole('button')
    expect(dayButtons.some(btn => btn.getAttribute('aria-pressed') === 'true')).toBe(true)

    fireEvent.click(hoursRadio)
    expect(hoursRadio).toHaveAttribute('aria-checked', 'true')
    expect(dailyRadio).toHaveAttribute('aria-checked', 'false')
  })

  test('[css] .runs li uses minmax(max-content, 200px) and tabular-nums on the date column', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/Schedules/Schedules.module.css'), 'utf8')
    expect(css).toMatch(/\.runs li\s*\{[^}]*grid-template-columns\s*:\s*minmax\(max-content,\s*200px\)\s+minmax\(0,\s*1fr\)\s+auto/)
    expect(css).toMatch(/\.runs li span:first-child\s*\{[^}]*font-variant-numeric\s*:\s*tabular-nums/)
  })

  test('SchedulesDialog renders LoadingState while initial state is null', () => {
    Object.assign(window, {
      oxe: {
        schedules: {
          state: vi.fn(() => new Promise(() => undefined)),
          runs: vi.fn(async () => []),
          onChanged: vi.fn(() => () => undefined)
        }
      }
    })

    render(<SchedulesDialog onClose={() => undefined} onOpenThread={() => undefined} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('No schedules yet')).toBeNull()
  })
})
