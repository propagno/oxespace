// Frozen acceptance test for the 1.5.0 cockpit removal R13, renderer side (OXE program, phase F2, task FE-R13). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R13).
// Contract (BACKEND R13, #678): DelegationTask.dependencies: Array<{ id, objective, state: DelegationState }>, resolved in
// main. "Waits for" = a dependency not 'approved'; "Blocked" = one is 'failed', 'cancelled' or 'interrupted'. Copy by
// DESIGN (08/11). /work stays a desktop command one release; main answers it with the delegations surface.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
function sources(dir: string): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(ROOT, rel))) {
      const path = `${rel}/${name}`
      if (statSync(join(ROOT, path)).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name)) out.push(path)
    }
  }
  walk(dir)
  return out
}

type Dependency = { id: string; objective: string; state: string }
const task = (id: string, objective: string, dependencies: Dependency[], extra: Record<string, unknown> = {}) => ({
  id, workspaceId: 'ws-1', objective, branch: `oxe/${id}`, state: 'accepted', agentProfileId: 'claude', surface: 'terminal',
  updatedAt: Date.UTC(2026, 9, 14), path: '/wt', baseSha: 'abc', cwd: '/repo', dependencies, ...extra
})

async function renderTasks(tasks: unknown[]) {
  const control = vi.fn(async () => undefined)
  Object.assign(window, { oxe: { delegation: {
    status: vi.fn(async () => ({ enabled: true, tasks })),
    onChanged: vi.fn(() => () => undefined),
    control,
    adopt: vi.fn(async () => undefined)
  } } })
  const { DelegatedWorkDialog } = await import('../../../src/components/Delegation/DelegatedWorkDialog')
  render(<DelegatedWorkDialog workspaces={[{ id: 'ws-1', name: 'repo' } as never]} workspaceId="ws-1" onClose={() => undefined} onOpen={async () => true} />)
  return control
}
const card = async (objective: string): Promise<HTMLElement> => (await screen.findByText(objective)).closest('article') as HTMLElement

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('R13 · Work folds into Delegated work', () => {
  test('the work panel is gone and no renderer source calls the work IPC', () => {
    expect(existsSync(join(ROOT, 'src/components/Threads/ThreadWorkPanel.tsx'))).toBe(false)
    const pattern = /ThreadWorkPanel|workRuns|cancelWork|thread:work-(runs|cancel)|surface === 'work'/
    expect(sources('src').filter(file => pattern.test(read(file)))).toEqual([])
  })

  test('the /work command opens Delegated work', async () => {
    const { DESKTOP_COMMANDS } = await import('../../../shared/threadDesktopCommands')
    expect(DESKTOP_COMMANDS.has('work')).toBe(true)
    const dialog = read('src/components/Threads/ThreadCommandDialog.tsx')
    expect(dialog).not.toMatch(/'work'/)
    expect(dialog).toMatch(/delegations/)
  })

  test('a waiting task says what it waits for, and names one plus a count when there are several', async () => {
    await renderTasks([
      task('t1', 'Write the migration', [{ id: 'd1', objective: 'Design the schema', state: 'accepted' }]),
      task('t2', 'Ship the docs', [
        { id: 'd2', objective: 'Write the guide', state: 'review' },
        { id: 'd3', objective: 'Record the demo', state: 'accepted' },
        { id: 'd4', objective: 'Translate the guide', state: 'starting' }
      ])
    ])
    expect(within(await card('Write the migration')).getByText('Waits for: Design the schema')).toBeInTheDocument()
    expect(within(await card('Ship the docs')).getByText('Waits for: Write the guide and 2 more')).toBeInTheDocument()
  })

  test('a task whose dependency failed says it is blocked', async () => {
    await renderTasks([task('t1', 'Write the migration', [{ id: 'd1', objective: 'Design the schema', state: 'failed' }])])
    expect(within(await card('Write the migration')).getByText('Blocked: Design the schema failed')).toBeInTheDocument()
  })

  test('a task whose dependencies are done shows no dependency line', async () => {
    await renderTasks([task('t1', 'Write the migration', [{ id: 'd1', objective: 'Design the schema', state: 'approved' }])])
    const article = await card('Write the migration')
    expect(within(article).queryByText(/Waits for|Blocked/)).toBeNull()
  })

  test('a running task can still be cancelled from Delegated work, after a confirm', async () => {
    const control = await renderTasks([task('t1', 'Write the migration', [], { recoveryActions: ['cancel'] })])
    const article = await card('Write the migration')
    await userEvent.click(within(article).getByRole('button', { name: /Cancel/ }))
    expect(control).not.toHaveBeenCalled()
    const confirm = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog', { name: /Cancel/ }))
    const buttons = within(confirm).getAllByRole('button', { name: /Cancel/ })
    await userEvent.click(buttons.find(button => button.textContent?.trim() !== 'Cancel') ?? buttons[buttons.length - 1])
    expect(control).toHaveBeenCalledWith('ws-1', 't1', 'cancel')
  })
})
