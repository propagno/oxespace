import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContainerInspect, ContainerSummary, OxeQueryEvent } from '../shared/types/oxequery'
import { connection, installFakeOxeQuery, refusal, type FakeOxeQuery } from './helpers/oxequery-api'

vi.mock('../src/components/Panes/TerminalPane', () => ({ TerminalPane: () => <div data-testid="terminal" /> }))
vi.mock('../src/components/OxeQuery/ActivityPanel', () => ({ ActivityPanel: ({ scope }: { scope?: string }) => <div data-testid="activity">{scope}</div> }))

import { OxePodView } from '../src/components/OxePod/OxePodView'
import { OxePodSidebar } from '../src/components/OxePod/OxePodSidebar'
import { useOxePodStore } from '../src/components/OxePod/oxepod.store'
import { onOxeQueryAction } from '../src/components/OxeQuery/oxequery-bridge'

const container = (change: Partial<ContainerSummary>): ContainerSummary => ({
  id: 'a'.repeat(64), name: 'web', image: 'nginx:1', state: 'running', status: 'Up 2 hours', ports: [{ hostPort: 8080, containerPort: 80, protocol: 'tcp' }], labels: {}, ...change
})
const postgres = container({ id: 'b'.repeat(64), name: 'pg-dev', image: 'postgres:16', ports: [{ hostIp: '0.0.0.0', hostPort: 5432, containerPort: 5432, protocol: 'tcp' }], labels: { 'com.docker.compose.project': 'shop', 'oxequery.managed': '1' } })
const mongo = container({ id: 'c'.repeat(64), name: 'mongo-dev', image: 'mongo:7', state: 'exited', status: 'Exited (0)', ports: [], labels: { 'com.docker.compose.project': 'shop' } })
const web = container({})
const inspectOf = (item: ContainerSummary, change: Partial<ContainerInspect> = {}): ContainerInspect => ({
  id: item.id, name: item.name, image: item.image, state: item.state, command: 'postgres', startedAt: Date.now() - 7_200_000, restartPolicy: 'always',
  environment: [{ name: 'POSTGRES_USER', value: 'dev' }, { name: 'POSTGRES_PASSWORD' }], mounts: [{ source: '/var/lib/docker/volumes/pg-data/_data', destination: '/var/lib/postgresql/data', volume: 'pg-data' }],
  networks: ['bridge'], ports: item.ports, ...change
})

let api: FakeOxeQuery
let listeners: ((event: OxeQueryEvent) => void)[]
const emit = (event: OxeQueryEvent): void => act(() => { for (const listener of listeners) listener(event) })
const DOCKER = { engine: 'docker' as const, available: true, state: 'ready' as const, version: '27.0', context: 'default' }

beforeEach(() => {
  api = installFakeOxeQuery()
  listeners = []
  const oxe = (window as unknown as { oxe: { oxeQuery: { onEvent: (listener: (event: OxeQueryEvent) => void) => () => void } } }).oxe
  oxe.oxeQuery.onEvent = listener => { listeners.push(listener); return () => { listeners = listeners.filter(item => item !== listener) } }
  api.on('containers.list', { containers: [web, postgres, mongo], engine: 'docker' })
  api.on('containers.engines', [DOCKER, { engine: 'podman', available: false, state: 'missing' }])
  api.on('containers.candidates', [])
  api.on('containers.stats', [{ id: 'b'.repeat(12), name: 'pg-dev', cpuPercent: 1.2, memoryPercent: 16.4, memoryUsage: '84MiB / 512MiB', netIO: '1kB / 2kB', blockIO: '0B / 0B', pids: 8 }])
  api.on('containers.action', { ok: true })
  api.on('containers.remove', (input: Record<string, unknown>) => { if (input.confirmed !== true) throw refusal('confirm', 'Confirm.'); return { ok: true } })
  api.on('containers.inspect', (input: Record<string, unknown>) => inspectOf([web, postgres, mongo].find(item => item.id === input.id)!))
  api.on('containers.logsStart', { streamId: 's1' })
  api.on('containers.logsStop', { ok: true })
  api.on('connections.list', [])
  useOxePodStore.setState({ containers: [web, postgres, mongo], error: null, loading: false, engine: 'docker', selected: postgres.id, view: 'container', filter: '', pendingPrune: null, engines: [DOCKER] })
})
afterEach(() => cleanup())

describe('OxePod sidebar', () => {
  it('groups containers by Compose project, then the others, running first, with a port or the state', async () => {
    render(<OxePodSidebar />)
    const shop = await screen.findByRole('region', { name: 'Project shop' })
    const rows = within(shop).getAllByRole('button')
    expect(rows.map(row => row.textContent)).toEqual(['pg-dev5432', 'mongo-devexited'])
    expect(within(screen.getByRole('region', { name: 'Others' })).getByRole('button', { name: /web/ })).toHaveTextContent('8080')
    expect(within(shop).getByRole('button', { name: /pg-dev/ })).toHaveAttribute('aria-current', 'page')
  })

  it('filters by name or image and says when nothing matches', async () => {
    render(<OxePodSidebar />)
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Filter containers' }), { target: { value: 'nginx' } })
    expect(screen.queryByRole('region', { name: 'Project shop' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Others' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter containers' }), { target: { value: 'zzz' } })
    expect(screen.getByText('No container matches the filter.')).toBeInTheDocument()
  })

  it('shows Docker and Podman side by side and switches the engine', async () => {
    useOxePodStore.setState({ engines: [DOCKER, { engine: 'podman', available: true, state: 'ready', version: '5.2' }] })
    render(<OxePodSidebar />)
    const engines = screen.getByRole('radiogroup', { name: 'Container engine' })
    expect(within(engines).getByRole('radio', { name: 'Docker' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Podman: active 5\.2/)).toBeInTheDocument()
    fireEvent.click(within(engines).getByRole('radio', { name: 'Podman' }))
    await waitFor(() => expect(api.callsOf('containers.list').some(call => call.engine === 'podman')).toBe(true))
  })

  it('opens a container, the resources and the agent activity', async () => {
    render(<OxePodSidebar />)
    fireEvent.click(await screen.findByRole('button', { name: /web/ }))
    expect(useOxePodStore.getState()).toMatchObject({ selected: web.id, view: 'container' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Images, volumes and networks' }).at(-1)!)
    expect(useOxePodStore.getState().view).toBe('resources')
    fireEvent.click(screen.getByRole('button', { name: 'Agent activity' }))
    expect(useOxePodStore.getState().view).toBe('activity')
  })
})

describe('OxePod container detail', () => {
  it('shows the selected container with its actions, logs live and its usage', async () => {
    render(<OxePodView active />)
    const detail = await screen.findByRole('region', { name: 'pg-dev details' })
    expect(detail).toHaveTextContent('postgres:16')
    expect(await within(detail).findByText(/started .*2 hours ago/)).toBeInTheDocument()
    for (const name of ['Stop pg-dev', 'Restart pg-dev', 'Terminal', 'Remove pg-dev…']) expect(within(detail).getByRole('button', { name })).toBeInTheDocument()
    await waitFor(() => expect(api.callsOf('containers.logsStart')).toHaveLength(1))
    emit({ type: 'container-log', streamId: 's1', lines: ['\u001b[32mready\u001b[0m to accept connections'] } as OxeQueryEvent)
    expect(await within(detail).findByLabelText('Container logs')).toHaveTextContent('ready to accept connections')
    const usage = await within(detail).findByLabelText('Usage')
    expect(usage).toHaveTextContent('CPU')
    expect(usage).toHaveTextContent('84.0 MB / 512.0 MB')
  })

  it('asks before removing, names the volumes that stay, and removes only after the confirmation', async () => {
    render(<OxePodView active />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove pg-dev…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove the container pg-dev?' })
    await waitFor(() => expect(dialog).toHaveTextContent('pg-data'))
    expect(dialog).toHaveTextContent('It is stopped first.')
    expect(dialog).toHaveTextContent('cannot be undone')
    expect(api.callsOf('containers.remove')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.callsOf('containers.remove')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Remove pg-dev…' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Remove the container pg-dev?' })).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.callsOf('containers.remove')).toEqual([{ id: postgres.id, engine: 'docker', confirmed: true }]))
  })

  it('asks before stopping a database, and stops another container straight away', async () => {
    render(<OxePodView active />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop pg-dev' }))
    const dialog = await screen.findByRole('dialog', { name: 'Stop pg-dev?' })
    expect(dialog).toHaveTextContent('named volume')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(api.callsOf('containers.action')).toEqual([{ id: postgres.id, action: 'stop', engine: 'docker' }]))
    cleanup()
    useOxePodStore.setState({ selected: web.id })
    api.on('containers.action', () => { throw refusal('failed', 'Cannot restart web.') })
    render(<OxePodView active />)
    fireEvent.click(await screen.findByRole('button', { name: 'Restart web' }))
    expect(await screen.findByText('Cannot restart web.')).toBeInTheDocument()
  })

  it('shows the environment redacted and the ports', async () => {
    render(<OxePodView active />)
    const detail = await screen.findByRole('region', { name: 'pg-dev details' })
    fireEvent.mouseDown(within(detail).getByRole('tab', { name: 'Environment' }), { button: 0 })
    const table = await within(detail).findByRole('table', { name: 'Environment' })
    expect(within(table).getByRole('row', { name: /POSTGRES_USER/ })).toHaveTextContent('dev')
    expect(within(table).getByRole('row', { name: /POSTGRES_PASSWORD/ })).toHaveTextContent('hidden')
    expect(detail).toHaveTextContent('1 value is hidden')
    fireEvent.mouseDown(within(detail).getByRole('tab', { name: 'Ports' }), { button: 0 })
    expect(await within(detail).findByRole('table', { name: 'Ports' })).toHaveTextContent('localhost:5432')
  })

  it('runs one command without a shell, and opens a terminal from the header', async () => {
    api.on('containers.exec', { exitCode: 0, stdout: 'total 0', stderr: '', truncated: false, timedOut: false })
    api.on('containers.shell', { paneId: 'pane-1' })
    render(<OxePodView active />)
    const detail = await screen.findByRole('region', { name: 'pg-dev details' })
    fireEvent.mouseDown(within(detail).getByRole('tab', { name: 'Command' }), { button: 0 })
    fireEvent.change(await within(detail).findByRole('textbox', { name: 'Command' }), { target: { value: 'ls  -la' } })
    fireEvent.click(within(detail).getByRole('button', { name: 'Run' }))
    expect(await within(detail).findByLabelText('Command output')).toHaveTextContent('total 0')
    expect(api.callsOf('containers.exec')[0]).toMatchObject({ id: postgres.id, argv: ['ls', '-la'] })
    fireEvent.click(within(detail).getByRole('button', { name: 'Terminal' }))
    expect(await within(detail).findByTestId('terminal')).toBeInTheDocument()
  })

  it('offers OxeQuery for a database container with host and port filled in, never a password', async () => {
    api.on('containers.suggestConnection', { engine: 'postgres', name: 'pg-dev', host: '127.0.0.1', port: 5432, database: 'app', username: 'app', hasPassword: true })
    const actions: string[] = []
    const off = onOxeQueryAction(action => actions.push(action))
    render(<OxePodView active />)
    const card = await screen.findByRole('region', { name: 'Database detected' })
    expect(card).toHaveTextContent('PostgreSQL on localhost:5432')
    fireEvent.click(within(card).getByRole('button', { name: 'Connect in OxeQuery' }))
    await waitFor(() => expect(actions).toEqual(['connect']))
    off()
    expect(JSON.stringify(api.calls)).not.toMatch(/password"\s*:/)
  })

  it('opens the saved connection when one already points at the container', async () => {
    api.on('connections.list', [connection({ id: 'saved', name: 'pg-dev', containerRef: 'pg-dev' })])
    render(<OxePodView active />)
    const card = await screen.findByRole('region', { name: 'Database detected' })
    expect(await within(card).findByRole('button', { name: 'Open in OxeQuery' })).toBeEnabled()
    expect(card).toHaveTextContent('Saved as the connection pg-dev.')
  })

  it('runs Compose for the project and asks before taking it down', async () => {
    api.on('containers.compose', (input: Record<string, unknown>) => {
      if (input.action === 'down' && !input.confirmed) throw refusal('confirm', 'Confirm.')
      return { output: input.action === 'logs' ? 'line one' : '' }
    })
    render(<OxePodView active />)
    const card = await screen.findByRole('region', { name: 'Compose project shop' })
    expect(card).toHaveTextContent('2 services · 1 of 2 running')
    fireEvent.click(within(card).getByRole('button', { name: 'Logs' }))
    expect(await within(card).findByText('line one')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Down…' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Take shop down?' })).getByRole('button', { name: 'Take down' }))
    await waitFor(() => expect(api.callsOf('containers.compose').some(call => call.action === 'down' && call.confirmed === true)).toBe(true))
  })
})

describe('OxePod view', () => {
  it('explains a stopped engine instead of an empty list', async () => {
    api.on('containers.list', () => { throw refusal('failed', 'Cannot reach the Docker daemon.') })
    useOxePodStore.setState({ containers: [], selected: null, error: 'Cannot reach the Docker daemon.', engines: [{ engine: 'docker', available: false, state: 'stopped' }] })
    render(<OxePodView active={false} />)
    expect(await screen.findByRole('heading', { name: 'Docker is not running' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Check again|Checking/ })).toBeInTheDocument()
  })

  it('warns when a remote Docker context is in use, and refreshes when the containers change', async () => {
    useOxePodStore.setState({ engines: [{ ...DOCKER, context: 'staging-host' }] })
    render(<OxePodView active />)
    expect(await screen.findByRole('note')).toHaveTextContent('staging-host')
    await waitFor(() => expect(api.callsOf('containers.list').length).toBeGreaterThan(0))
    const before = api.callsOf('containers.list').length
    emit({ type: 'containers-changed' } as OxeQueryEvent)
    await waitFor(() => expect(api.callsOf('containers.list').length).toBeGreaterThan(before))
  })

  it('cleans up stopped containers only after the confirmation', async () => {
    api.on('resources.images', []); api.on('resources.volumes', []); api.on('resources.networks', []); api.on('resources.usage', [])
    api.on('resources.prune', { output: 'Total reclaimed space: 12MB' })
    useOxePodStore.setState({ view: 'resources' })
    render(<OxePodView active />)
    fireEvent.click(await screen.findByRole('button', { name: 'Clean up stopped…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove every stopped container?' })
    expect(api.callsOf('resources.prune')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clean up' }))
    await waitFor(() => expect(api.callsOf('resources.prune')).toEqual([{ kind: 'containers', engine: 'docker', confirmed: true }]))
  })

  it('shows the container requests of agents', async () => {
    useOxePodStore.setState({ view: 'activity' })
    render(<OxePodView active />)
    expect(await screen.findByTestId('activity')).toHaveTextContent('containers')
  })
})
