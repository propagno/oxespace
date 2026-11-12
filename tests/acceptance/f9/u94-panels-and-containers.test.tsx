// Frozen acceptance test for 1.5.0 A34 on screen (DESIGN U9.4, OXE program, phase F9, task FE-A34). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f9-design.md (U9.4).
// Contract (BACKEND #721 @ f2d713da §A34): window.oxe.oxePod.call('containers.panel', { engine? }) → { ok: true, value:
// { engine: { state: 'ready' | 'missing' | 'stopped' | 'denied', engine? }, rows: [{ id, name, image, status, ports, stack,
// upSince, isDatabase, startedBy: { kind: 'conversation', conversationId, title, provider } | { kind: 'person' } | null }] } };
// the actions stay containers.action ({ id, action }), containers.remove ({ id, confirmed }), containers.compose ({ id, action:
// 'stop', confirmed }); Connect is containers.suggestConnection then requestOxeQueryConnect (no password ever).
// The renderer part: ContainersPanel({ onOpenConversation(id) }) in src/components/Containers/ContainersPanel.tsx, the same
// panel in the OxeCode dock, a conversation's "+ Tool" and Tools › Containers. U9.4d (themes, the 420 px dock, axe) is e2e.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Row = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

const NOW = Date.now()
const ROWS = [
  { id: 'c-db', name: 'shop-db-1', image: 'postgres:16', status: 'running', ports: [{ hostPort: 5432, containerPort: 5432, protocol: 'tcp' }], stack: 'shop', upSince: NOW - 3_600_000, isDatabase: true, startedBy: { kind: 'conversation', conversationId: 't-pix', title: 'Pix webhook', provider: 'claude' } },
  { id: 'c-api', name: 'shop-api-1', image: 'node:22', status: 'running', ports: [], stack: 'shop', upSince: NOW - 600_000, isDatabase: false, startedBy: { kind: 'person' } },
  { id: 'c-cache', name: 'redis', image: 'redis:7', status: 'exited', ports: [], stack: null, upSince: null, isDatabase: false, startedBy: null }
]
function mockMain(panel: Row = { engine: { state: 'ready', engine: 'docker' }, rows: ROWS }) {
  const call = vi.fn(async (op: string) => {
    if (op === 'containers.panel') return { ok: true, value: panel }
    if (op === 'containers.suggestConnection') return { ok: true, value: { engine: 'postgres', name: 'shop-db-1', host: 'localhost', port: 5432, database: 'shop', username: 'postgres', hasPassword: true } }
    if (op === 'containers.logsStart') return { ok: true, value: { streamId: 's-1' } }
    return { ok: true, value: { ok: true } }
  })
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, oxePod: { call, onEvent: vi.fn(() => () => undefined) } } })
  return call
}
async function renderPanel() {
  const { ContainersPanel } = await load<{ ContainersPanel: (props: Row) => JSX.Element }>('src/components/Containers/ContainersPanel')
  const { Toaster } = await import('../../../src/ui/Toast')
  const onOpenConversation = vi.fn()
  render(<><ContainersPanel onOpenConversation={onOpenConversation} /><Toaster /></>)
  return { onOpenConversation }
}
const rowOf = (name: string) => screen.getByText(name).closest('li, [role="option"], [role="row"]') as HTMLElement
const select = async (name: string) => { await userEvent.click(await screen.findByText(name)) }
const opsCalled = (call: ReturnType<typeof mockMain>) => call.mock.calls.map(([op, input]) => [op, input])

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('U9.4 · The panels instead of modes', () => {
  test('Ctrl 1–3 are the three modes, and no shortcut opens an OxePod or OxePost mode', async () => {
    const { KEYBINDINGS, APP_VIEWS } = await import('../../../src/keyboard/keybindings')
    const chord = (key: string) => KEYBINDINGS.filter(binding => (binding.chords as readonly string[]).includes(key)).map(binding => binding.id as string)
    expect([chord('Mod+1'), chord('Mod+2'), chord('Mod+3')]).toEqual([['view.code'], ['view.thread'], ['view.data']])
    expect([...chord('Mod+4'), ...chord('Mod+5')]).toEqual([])
    expect(APP_VIEWS as readonly string[]).not.toContain('pods')
    expect(APP_VIEWS as readonly string[]).not.toContain('post')
  })

  test('the panel reads containers.panel, groups rows by stack, and names who started each: a conversation, You, or Outside OXESpace', async () => {
    const call = mockMain()
    const props = await renderPanel()
    await screen.findByText('shop-db-1')
    expect(call).toHaveBeenCalledWith('containers.panel', expect.anything())
    expect(call.mock.calls.some(([op]) => op === 'containers.list')).toBe(false)
    const shop = screen.getByRole('group', { name: /shop/ })
    expect(within(shop).getByText('shop-db-1')).toBeInTheDocument()
    expect(within(shop).getByText('shop-api-1')).toBeInTheDocument()
    expect(within(shop).queryByText('redis')).toBeNull()
    expect(within(rowOf('shop-db-1')).getByText('Pix webhook')).toBeInTheDocument()
    expect(within(rowOf('shop-api-1')).getByText('You')).toBeInTheDocument()
    const outside = within(rowOf('redis')).getByText('Outside OXESpace')
    expect(within(rowOf('redis')).queryByText('You')).toBeNull()
    expect(outside.closest('a, button')).toBeNull()
    expect(outside.getAttribute('title') ?? outside.closest('[title]')?.getAttribute('title')).toBe('Started before OXESpace or by another tool')
    await userEvent.click(within(rowOf('shop-db-1')).getByText('Pix webhook'))
    expect(props.onOpenConversation).toHaveBeenCalledWith('t-pix')
  })

  test('the detail shows the status with Stop for a running container and Start for a stopped one, plus Restart', async () => {
    mockMain()
    await renderPanel()
    await select('shop-api-1')
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument()
    await select('redis')
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  test('Stop on one container stops it with an undo toast, and Undo starts it again', async () => {
    const call = mockMain()
    await renderPanel()
    await select('shop-api-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(opsCalled(call)).toContainEqual(['containers.action', expect.objectContaining({ id: 'c-api', action: 'stop' })]))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(opsCalled(call)).toContainEqual(['containers.action', expect.objectContaining({ id: 'c-api', action: 'start' })]))
  })

  test('Connect in OxeQuery shows only for a database image and opens New connection from the suggestion, never with a password', async () => {
    const call = mockMain()
    const { onOxeQueryAction } = await import('../../../src/components/OxeQuery/oxequery-bridge')
    const actions: string[] = []
    const stop = onOxeQueryAction(action => { actions.push(action as string) })
    try {
      await renderPanel()
      await select('shop-api-1')
      await userEvent.click(await screen.findByRole('button', { name: /More actions|⋯/ }))
      expect(screen.queryByRole('menuitem', { name: 'Connect in OxeQuery' })).toBeNull()
      await userEvent.keyboard('{Escape}')
      await select('shop-db-1')
      await userEvent.click(await screen.findByRole('button', { name: /More actions|⋯/ }))
      const menu = await screen.findByRole('menu')
      expect(within(menu).getAllByRole('menuitem').map(item => item.textContent?.replace(/…$/, '…').trim())).toEqual(['Open a shell', 'Copy container ID', 'Connect in OxeQuery', 'Stop the whole stack…', 'Remove container…'])
      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Connect in OxeQuery' }))
      await waitFor(() => expect(opsCalled(call)).toContainEqual(['containers.suggestConnection', expect.objectContaining({ id: 'c-db' })]))
      await waitFor(() => expect(actions).toContain('connect'))
      expect(JSON.stringify(call.mock.calls)).not.toMatch(/password/i)
    } finally { stop() }
  })

  test.each([
    ['Stop the whole stack…', 'containers.compose', { id: 'c-db', action: 'stop', confirmed: true }],
    ['Remove container…', 'containers.remove', { id: 'c-db', confirmed: true }]
  ])('%s confirms with Cancel focused, and only the confirm runs %s', async (item, op, input) => {
    const call = mockMain()
    await renderPanel()
    await select('shop-db-1')
    await userEvent.click(await screen.findByRole('button', { name: /More actions|⋯/ }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: item as string }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(call.mock.calls.some(([name]) => name === op)).toBe(false)
    await userEvent.click(await screen.findByRole('button', { name: /More actions|⋯/ }))
    await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: item as string }))
    const again = await screen.findByRole('dialog')
    await userEvent.click(within(again).getAllByRole('button').find(button => button.textContent?.trim() !== 'Cancel')!)
    await waitFor(() => expect(opsCalled(call)).toContainEqual([op, expect.objectContaining(input as Row)]))
  })

  test.each([
    ['stopped', 'docker', "Docker isn't answering", 'Start Docker, then try again.', 'Try again'],
    ['missing', 'docker', 'Docker not found', 'Install Docker or Podman, then reopen this panel.', 'How to install'],
    ['denied', 'docker', "Can't reach Docker", 'Check that your user may use Docker, then try again.', 'Try again'],
    ['stopped', 'podman', "Podman isn't answering", 'Start Podman, then try again.', 'Try again']
  ])('the engine state %s (%s) is one Notice with its line and action, never a toast', async (state, engine, title, line, action) => {
    const call = mockMain({ engine: { state, engine }, rows: [] })
    await renderPanel()
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.getByText(line)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: action })
    if (action === 'Try again') {
      const before = call.mock.calls.filter(([op]) => op === 'containers.panel').length
      await userEvent.click(button)
      await waitFor(() => expect(call.mock.calls.filter(([op]) => op === 'containers.panel').length).toBe(before + 1))
    }
  })

  test('with no containers the panel says how to start some', async () => {
    mockMain({ engine: { state: 'ready', engine: 'docker' }, rows: [] })
    await renderPanel()
    expect(await screen.findByText('No containers. Start a compose stack from a project.')).toBeInTheDocument()
  })

  test('the panel reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    mockMain()
    await renderPanel()
    expect(await screen.findByText('Você')).toBeInTheDocument()
    expect(screen.getByText('Fora do OXESpace')).toBeInTheDocument()
    await select('shop-db-1')
    await userEvent.click(await screen.findByRole('button', { name: /Mais ações|⋯/ }))
    expect(await screen.findByRole('menuitem', { name: 'Conectar no OxeQuery' })).toBeInTheDocument()
    cleanup()
    mockMain({ engine: { state: 'stopped', engine: 'docker' }, rows: [] })
    await renderPanel()
    expect(await screen.findByText('O Docker não está respondendo')).toBeInTheDocument()
    expect(screen.getByText('Inicie o Docker e tente de novo.')).toBeInTheDocument()
    expect(screen.queryByText('Fora do OXESpace')).toBeNull()
  })
})
