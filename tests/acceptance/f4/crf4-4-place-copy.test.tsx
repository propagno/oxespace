// Frozen acceptance test for CR-F4-4 (OXE program, phase F4, task FE-P4, criterion A16): DESIGN's copy review of #745
// (logged by DESIGN as CR-F4-1). The place labels are U4.1's everywhere ("Another checkout", "Outside the repository"),
// the pt-BR missing line and Find file follow U4.3, and pt-BR "worktree" is feminine, as everywhere else in the app.
// Written by the planner; the executor must not edit it. It renders the real PathLink and OutsideFileTab against the
// same faked main as u43 (window.oxe.thread places / resolvePath / placeRead) and reads what a person sees.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

const opener = vi.hoisted(() => ({ openPlaceFile: vi.fn(async () => undefined) }))
vi.mock('../../../src/components/Threads/openPlaceFile', () => opener)

async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const PLACES = { places: [
  { id: 'pl-tree', kind: 'worktree', path: '/repo-trees/agent-fix', base: null, current: null, writes: 1, files: [], drift: null },
  { id: 'pl-sib', kind: 'sibling', path: '/repo-trees/other-task', base: null, current: null, writes: 0, files: [], drift: null },
  { id: 'pl-co', kind: 'checkout', path: '/other-repo', base: null, current: null, writes: 1, files: ['README.md'], drift: null },
  { id: 'pl-out', kind: 'outside', path: '/home/me/notes', base: null, current: null, writes: 1, files: ['ROTEIRO.md'], drift: null }
], capped: false }

function mockMain(resolve: unknown) {
  const thread = {
    places: vi.fn(async () => PLACES),
    resolvePath: vi.fn(async () => resolve),
    placeRead: vi.fn(async (_threadId: string, _placeId: string, relativePath: string) => ({ relativePath, content: '# Notes', size: 7, mtimeMs: 1, readOnly: true })),
    onPlacesChanged: vi.fn(() => () => undefined)
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread, clipboard: { writeText: vi.fn(async () => undefined) } } })
  return thread
}
async function openLink(raw: string): Promise<void> {
  const { PathLink } = await load<{ PathLink: (props: { threadId: string; raw: string; turnId?: string }) => JSX.Element }>('src/components/Threads/PathLink')
  render(<p>See <PathLink threadId="t-1" raw={raw} turnId="turn-1" /> for the fix.</p>)
  await userEvent.click(screen.getByRole('link', { name: new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }))
}
const AMBIGUOUS = { kind: 'ambiguous', candidates: [
  { path: '/other-repo/src/x.ts', placeId: 'pl-co', via: 'task-place' },
  { path: '/home/me/notes/src/x.ts', placeId: 'pl-out', via: 'task-place' },
  { path: '/repo-trees/other-task/src/x.ts', placeId: 'pl-sib', via: 'sibling-worktree' }
] }
const MISSING = { kind: 'missing', looked: [
  { step: 'task-worktree', path: '/repo-trees/agent-fix/lib/y.ts' }, { step: 'sibling-worktree', path: '/repo-trees/other-task/lib/y.ts' }
] }

afterEach(async () => { cleanup(); vi.clearAllMocks(); await changeLanguage('en') })

describe('CR-F4-4 · the place labels and the pt-BR path copy follow U4.1 and U4.3', () => {
  test.each([
    ['en', ['Another checkout · src/x.ts', 'Outside the repository · src/x.ts', 'Sibling worktree · src/x.ts'], 'Which one?'],
    ['pt-BR', ['Outro checkout · src/x.ts', 'Fora do repositório · src/x.ts', 'Worktree irmã · src/x.ts'], 'Qual deles?']
  ])('the Which one? menu names each place with U4.1\'s labels (%s)', async (language, items, name) => {
    await changeLanguage(language as string)
    mockMain(AMBIGUOUS)
    await openLink('src/x.ts')
    const menu = await screen.findByRole('menu', { name: name as string })
    expect(within(menu).getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual(items)
  }, 30_000)

  test.each([
    ['en', /^Read only · another checkout · \/other-repo\/README\.md$/],
    ['pt-BR', /^Somente leitura · outro checkout · \/other-repo\/README\.md$/]
  ])('a file in another checkout opens read only with the another-checkout band (%s)', async (language, band) => {
    await changeLanguage(language as string)
    mockMain({ kind: 'found', path: '/other-repo/README.md', placeId: 'pl-co', via: 'task-place' })
    const { OutsideFileTab } = await load<{ OutsideFileTab: (props: { threadId: string; placeId: string; relativePath: string }) => JSX.Element }>('src/components/Threads/OutsideFileTab')
    render(<OutsideFileTab threadId="t-1" placeId="pl-co" relativePath="README.md" />)
    expect(await screen.findByText(band as RegExp)).toBeInTheDocument()
    expect(screen.queryByText(/another repository|outro repositório/i)).toBeNull()
  }, 30_000)

  test('in pt-BR a missing path reads "Procurei, em ordem:" with Procurar arquivo…, and worktree is feminine in each step', async () => {
    await changeLanguage('pt-BR')
    mockMain(MISSING)
    await openLink('lib/y.ts')
    expect(await screen.findByText(/lib\/y\.ts não foi encontrado\. Procurei, em ordem:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Procurar arquivo…' })).toBeInTheDocument()
    expect(screen.getByText(/\(a worktree da tarefa\)/)).toBeInTheDocument()
    expect(screen.getByText(/\(uma worktree irmã\)/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\bo worktree\b|\bum worktree\b|worktree irmão/i)
  }, 30_000)
})
