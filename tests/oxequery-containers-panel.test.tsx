import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContainerSummary, OxeQueryEvent } from '../shared/types/oxequery'
import { connection, installFakeOxeQuery, refusal, type FakeOxeQuery } from './helpers/oxequery-api'

vi.mock('../src/components/Panes/TerminalPane', () => ({ TerminalPane: () => <div data-testid="terminal" /> }))
vi.mock('../src/components/OxeQuery/ResourcesPanel', () => ({
  ResourcesPanel: () => <div data-testid="resources" />,
  NewDatabaseDialog: ({ onClose }: { onClose: () => void }) => <div role="dialog" aria-label="New database dialog"><button type="button" onClick={onClose}>Close wizard</button></div>
}))

import { ContainersPanel, formatPorts, isDatabaseImage } from '../src/components/OxeQuery/ContainersPanel'
import { useOxeQueryStore } from '../src/components/OxeQuery/oxequery.store'

const container = (change: Partial<ContainerSummary>): ContainerSummary => ({
  id: 'a'.repeat(64), name: 'web', image: 'nginx:1', state: 'running', status: 'Up 2 hours', ports: [{ hostPort: 8080, containerPort: 80, protocol: 'tcp' }], labels: {}, ...change
})
const postgres = container({ id: 'b'.repeat(64), name: 'pg-dev', image: 'postgres:16', ports: [{ hostPort: 5432, containerPort: 5432, protocol: 'tcp' }], labels: { 'com.docker.compose.project': 'shop', 'oxequery.managed': '1' } })
const mongo = container({ id: 'c'.repeat(64), name: 'mongo-dev', image: 'mongo:7', state: 'exited', status: 'Exited (0)', ports: [], labels: { 'com.docker.compose.project': 'shop' } })
const web = container({})

let api: FakeOxeQuery
let listeners: ((event: OxeQueryEvent) => void)[]
const emit = (event: OxeQueryEvent): void => act(() => { for (const listener of listeners) listener(event) })

beforeEach(() => {
  api = installFakeOxeQuery()
  listeners = []
  const oxe = (window as unknown as { oxe: { oxeQuery: { onEvent: (listener: (event: OxeQueryEvent) => void) => () => void } } }).oxe
  oxe.oxeQuery.onEvent = listener => { listeners.push(listener); return () => { listeners = listeners.filter(item => item !== listener) } }
  api.on('containers.list', { containers: [web, postgres, mongo], engine: 'docker' })
  api.on('containers.engines', [{ engine: 'docker', available: true, state: 'ready', version: '27.0', context: 'default' }])
  api.on('containers.candidates', [])
  api.on('containers.stats', [{ id: 'b'.repeat(12), name: 'pg-dev', cpuPercent: 2.5, memoryPercent: 10, memoryUsage: '120MiB / 1GiB', netIO: '', blockIO: '' }])
  api.on('containers.action', {})
  useOxeQueryStore.setState({
    containers: [web, postgres, mongo], containersError: null, containersLoading: false, engine: 'docker', selectedContainer: null, connections: [],
    engines: [{ engine: 'docker', available: true, state: 'ready', version: '27.0', context: 'default' }]
  })
})
afterEach(() => cleanup())

describe('container helpers', () => {
  it('formats published ports first and lists internal ports only when nothing is published', () => {
    expect(formatPorts([{ hostPort: 8080, containerPort: 80, protocol: 'tcp' }, { containerPort: 9000, protocol: 'tcp' }])).toBe('8080→80')
    expect(formatPorts([{ containerPort: 9000, protocol: 'tcp' }, { containerPort: 9000, protocol: 'udp' }])).toBe('9000')
    expect(formatPorts([])).toBe('')
  })
  it('recognises the database images OxeQuery can query', () => {
    expect(['postgres:16', 'postgis/postgis', 'timescale/timescaledb', 'pgvector/pgvector', 'mongo:7'].every(isDatabaseImage)).toBe(true)
    expect(isDatabaseImage('nginx:1')).toBe(false)
  })
})

describe('ContainersPanel', () => {
  it('lists containers, the summary and the stats of what is running', async () => {
    render(<ContainersPanel active />)
    const table = await screen.findByRole('table', { name: 'Container list' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    const summary = screen.getByLabelText('Summary')
    expect(summary).toHaveTextContent('2 running')
    expect(summary).toHaveTextContent('1 stopped')
    expect(summary).toHaveTextContent('2 databases')
    expect(await within(table).findByText('2.5%')).toBeInTheDocument()
    expect(screen.getByText('Engine: docker (default)')).toBeInTheDocument()
  })

  it('filters by text and by running state, and says when nothing matches', async () => {
    render(<ContainersPanel active />)
    await screen.findByRole('table', { name: 'Container list' })
    fireEvent.change(screen.getByLabelText('Filter containers'), { target: { value: 'mongo' } })
    expect(within(screen.getByRole('table', { name: 'Container list' })).getAllByRole('row')).toHaveLength(2)
    fireEvent.click(screen.getByLabelText('Running only'))
    expect(await screen.findByText('No container matches the filter.')).toBeInTheDocument()
  })

  it('starts a container that is stopped without asking', async () => {
    render(<ContainersPanel active />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start mongo-dev' }))
    await waitFor(() => expect(api.callsOf('containers.action')).toHaveLength(1))
    expect(api.callsOf('containers.action')[0]).toMatchObject({ id: mongo.id, action: 'start' })
  })

  it('asks before stopping a database and acts only after the confirmation', async () => {
    render(<ContainersPanel active />)
    fireEvent.click(await screen.findByRole('button', { name: 'Stop pg-dev' }))
    const dialog = await screen.findByRole('dialog', { name: 'Stop pg-dev?' })
    expect(dialog).toHaveTextContent('named volume')
    expect(api.callsOf('containers.action')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(api.callsOf('containers.action')).toHaveLength(1))
    expect(api.callsOf('containers.action')[0]).toMatchObject({ id: postgres.id, action: 'stop' })
  })

  it('stops a container that is not a database straight away, and shows a failure', async () => {
    api.on('containers.action', () => { throw refusal('failed', 'Cannot stop web.') })
    render(<ContainersPanel active />)
    fireEvent.click(await screen.findByRole('button', { name: 'Restart web' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot stop web.')
    expect(api.callsOf('containers.action')[0]).toMatchObject({ action: 'restart' })
  })

  it('opens a connection to a running database container', async () => {
    const created = connection({ id: 'new', name: 'pg-dev' })
    api.on('connections.fromContainer', created)
    api.on('connections.list', [created])
    render(<ContainersPanel active />)
    expect(await screen.findByRole('button', { name: 'Connect to mongo-dev' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Connect to pg-dev' }))
    await waitFor(() => expect(useOxeQueryStore.getState().activeTab).toBe('connection:new'))
    expect(api.callsOf('connections.fromContainer')[0]).toMatchObject({ id: postgres.id })
  })

  it('explains the first step when there are databases but no connection yet', async () => {
    render(<ContainersPanel active />)
    expect(await screen.findByRole('note')).toHaveTextContent('press Query on a PostgreSQL or MongoDB container')
  })

  it('runs Compose actions for one project, and asks before taking it down', async () => {
    api.on('containers.compose', (input: Record<string, unknown>) => {
      if (input.action === 'down' && !input.confirmed) throw refusal('confirm', 'Confirm.')
      return { output: input.action === 'logs' ? 'line one' : '' }
    })
    render(<ContainersPanel active />)
    fireEvent.change(await screen.findByLabelText('Compose project'), { target: { value: 'shop' } })
    const group = screen.getByRole('region', { name: 'Compose project actions' })
    expect(group).toHaveTextContent('1 of 2 running')
    fireEvent.click(within(group).getByRole('button', { name: 'Logs' }))
    expect(await screen.findByText('line one')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close output' }))
    fireEvent.click(within(group).getByRole('button', { name: 'Down…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Take shop down?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Take down' }))
    await waitFor(() => expect(api.callsOf('containers.compose').some(call => call.action === 'down' && call.confirmed === true)).toBe(true))
  })

  it('shows the engine problem instead of an empty list when Docker is not running', async () => {
    api.on('containers.list', () => { throw refusal('failed', 'Cannot reach the Docker daemon.') })
    useOxeQueryStore.setState({ containers: [], containersError: 'Cannot reach the Docker daemon.', engines: [{ engine: 'docker', available: false, state: 'stopped' }] })
    render(<ContainersPanel active />)
    expect(await screen.findByRole('heading', { name: 'Docker is not running' })).toBeInTheDocument()
    expect(screen.getByText('Cannot reach the Docker daemon.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Check again|Checking/ })).toBeInTheDocument()
  })

  it('names the missing engine and the denied socket', async () => {
    useOxeQueryStore.setState({ containers: [], containersError: 'none', engines: [{ engine: 'docker', available: false, state: 'missing' }, { engine: 'podman', available: false, state: 'missing' }] })
    const view = render(<ContainersPanel active={false} />)
    expect(await screen.findByRole('heading', { name: 'No container engine found' })).toBeInTheDocument()
    view.unmount()
    useOxeQueryStore.setState({ engines: [{ engine: 'docker', available: false, state: 'denied' }] })
    render(<ContainersPanel active={false} />)
    expect(await screen.findByRole('heading', { name: 'Not allowed to use Docker' })).toBeInTheDocument()
  })

  it('warns when a remote Docker context is in use, and opens and closes the wizard and the resources', async () => {
    useOxeQueryStore.setState({ engines: [{ engine: 'docker', available: true, state: 'ready', context: 'staging-host' }] })
    render(<ContainersPanel active />)
    expect(await screen.findByText(/Docker context/)).toHaveTextContent('staging-host')
    fireEvent.click(screen.getByRole('button', { name: 'New database' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close wizard' }))
    fireEvent.click(screen.getByRole('button', { name: 'Images, volumes and networks' }))
    expect(await screen.findByTestId('resources')).toBeInTheDocument()
  })

  it('refreshes when the main process says the containers changed', async () => {
    render(<ContainersPanel active />)
    await screen.findByRole('table', { name: 'Container list' })
    const before = api.callsOf('containers.list').length
    emit({ type: 'containers-changed' } as OxeQueryEvent)
    await waitFor(() => expect(api.callsOf('containers.list').length).toBeGreaterThan(before))
  })
})

describe('container details', () => {
  const open = async (): Promise<HTMLElement> => {
    render(<ContainersPanel active />)
    fireEvent.click(await screen.findByRole('button', { name: 'pg-dev' }))
    return screen.findByRole('complementary', { name: 'pg-dev details' })
  }

  it('shows what the container is made of, names only for the environment', async () => {
    api.on('containers.inspect', { id: postgres.id, name: 'pg-dev', image: 'postgres:16', state: 'running', command: 'postgres', health: 'healthy', restartPolicy: 'always', startedAt: 1_700_000_000_000, envNames: ['POSTGRES_USER'], mounts: [{ source: 'vol', destination: '/data' }], networks: ['bridge'], ports: [] })
    const details = await open()
    expect(await within(details).findByText('healthy')).toBeInTheDocument()
    expect(details).toHaveTextContent('POSTGRES_USER')
    expect(details).toHaveTextContent('(names only)')
    expect(details).toHaveTextContent('vol → /data')
    fireEvent.click(within(details).getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('reports an inspect failure', async () => {
    api.on('containers.inspect', () => { throw refusal('failed', 'No such container.') })
    const details = await open()
    expect(await within(details).findByRole('alert')).toHaveTextContent('No such container.')
  })

  it('streams logs without colour codes, filters and pauses them, and stops the stream on leaving', async () => {
    api.on('containers.inspect', { id: postgres.id, name: 'pg-dev', image: 'postgres:16', state: 'running', command: '', envNames: [], mounts: [], networks: [], ports: [] })
    api.on('containers.logsStart', { streamId: 's1' })
    api.on('containers.logsStop', {})
    const details = await open()
    fireEvent.click(within(details).getByRole('button', { name: 'Logs' }))
    await waitFor(() => expect(api.callsOf('containers.logsStart')).toHaveLength(1))
    emit({ type: 'container-log', streamId: 's1', lines: ['\u001b[32mready\u001b[0m to accept', 'checkpoint done'] } as OxeQueryEvent)
    const logs = await within(details).findByLabelText('Container logs')
    expect(logs).toHaveTextContent('ready to accept')
    expect(logs).not.toHaveTextContent('[32m')
    fireEvent.change(within(details).getByLabelText('Filter logs'), { target: { value: 'checkpoint' } })
    expect(logs).not.toHaveTextContent('ready to accept')
    fireEvent.change(within(details).getByLabelText('Filter logs'), { target: { value: '' } })
    fireEvent.click(within(details).getByRole('button', { name: 'Pause' }))
    emit({ type: 'container-log', streamId: 's1', lines: ['hidden while paused'] } as OxeQueryEvent)
    expect(logs).not.toHaveTextContent('hidden while paused')
    fireEvent.click(within(details).getByRole('button', { name: 'Clear' }))
    expect(logs).toHaveTextContent('Waiting for output…')
    emit({ type: 'container-log-end', streamId: 's1', reason: 'connection lost' } as OxeQueryEvent)
    expect(await within(details).findByRole('alert')).toHaveTextContent('connection lost')
    fireEvent.click(within(details).getByRole('button', { name: 'Overview' }))
    await waitFor(() => expect(api.callsOf('containers.logsStop')).toEqual([{ streamId: 's1' }]))
  })

  it('runs one command without a shell and shows its exit code and output', async () => {
    api.on('containers.inspect', { id: postgres.id, name: 'pg-dev', image: 'postgres:16', state: 'running', command: '', envNames: [], mounts: [], networks: [], ports: [] })
    api.on('containers.exec', { exitCode: 0, stdout: 'total 0', stderr: 'warn', truncated: true, timedOut: false })
    const details = await open()
    fireEvent.click(within(details).getByRole('button', { name: 'Run command' }))
    expect(within(details).getByRole('button', { name: 'Run' })).toBeDisabled()
    fireEvent.change(within(details).getByLabelText('Command'), { target: { value: 'ls  -la   /var' } })
    fireEvent.click(within(details).getByRole('button', { name: 'Run' }))
    expect(await within(details).findByLabelText('Command output')).toHaveTextContent('total 0')
    expect(details).toHaveTextContent('Exit code 0 · output truncated')
    expect(api.callsOf('containers.exec')[0]).toMatchObject({ id: postgres.id, argv: ['ls', '-la', '/var'] })
  })

  it('refuses to run a command or open a shell in a stopped container', async () => {
    api.on('containers.inspect', { id: mongo.id, name: 'mongo-dev', image: 'mongo:7', state: 'exited', command: '', envNames: [], mounts: [], networks: [], ports: [] })
    render(<ContainersPanel active />)
    fireEvent.click(await screen.findByRole('button', { name: 'mongo-dev' }))
    const details = await screen.findByRole('complementary', { name: 'mongo-dev details' })
    fireEvent.click(within(details).getByRole('button', { name: 'Run command' }))
    expect(within(details).getByLabelText('Command')).toBeDisabled()
    expect(details).toHaveTextContent('Start the container to run commands.')
    fireEvent.click(within(details).getByRole('button', { name: 'Shell' }))
    expect(details).toHaveTextContent('Start the container to open a shell.')
  })

  it('opens an interactive shell in a running container', async () => {
    api.on('containers.inspect', { id: postgres.id, name: 'pg-dev', image: 'postgres:16', state: 'running', command: '', envNames: [], mounts: [], networks: [], ports: [] })
    api.on('containers.shell', { paneId: 'pane-1' })
    const details = await open()
    fireEvent.click(within(details).getByRole('button', { name: 'Shell' }))
    expect(await within(details).findByTestId('terminal')).toBeInTheDocument()
    fireEvent.click(within(details).getByRole('button', { name: 'New session' }))
    await waitFor(() => expect(api.callsOf('containers.shell').length).toBe(2))
    expect(api.callsOf('containers.shell')[0]).toMatchObject({ id: postgres.id, shell: 'sh' })
  })
})
