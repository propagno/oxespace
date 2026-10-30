import { beforeEach, describe, expect, it } from 'vitest'
import type { ContainerSummary } from '../../shared/types/oxepod'
import { redactEnvironment } from '../../shared/environment-redaction'
import { databaseKind, defaultSelection, firstHostPort, formatPorts, groupContainers, isDatabaseImage, memoryOf, parseSize, statFor, stateStatus } from '../../src/components/OxePod/pods-model'
import { useOxePodStore } from '../../src/components/OxePod/oxepod.store'
import { useOxeQueryStore } from '../../src/components/OxeQuery/oxequery.store'
import { onOxeQueryAction, performOxeQueryAction, requestOxeQueryConnect } from '../../src/components/OxeQuery/oxequery-bridge'
import { installFakeOxeQuery } from '../helpers/oxequery-api'
import { connection } from '../helpers/oxequery-api'

const container = (change: Partial<ContainerSummary>): ContainerSummary => ({ id: 'x'.repeat(64), name: 'x', image: 'alpine', state: 'running', status: '', ports: [], labels: {}, ...change })

describe('container model', () => {
  it('formats published ports first and lists internal ports only when nothing is published', () => {
    expect(formatPorts([{ hostPort: 8080, containerPort: 80, protocol: 'tcp' }, { containerPort: 9000, protocol: 'tcp' }])).toBe('8080→80')
    expect(formatPorts([{ containerPort: 9000, protocol: 'tcp' }, { containerPort: 9000, protocol: 'udp' }])).toBe('9000')
    expect(formatPorts([])).toBe('')
    expect(firstHostPort([{ containerPort: 1, protocol: 'tcp' }, { hostPort: 15432, containerPort: 5432, protocol: 'tcp' }])).toBe(15432)
  })

  it('recognises the databases OxeQuery opens', () => {
    expect(['postgres:16', 'postgis/postgis', 'timescale/timescaledb', 'pgvector/pgvector'].map(databaseKind)).toEqual(['postgres', 'postgres', 'postgres', 'postgres'])
    expect(databaseKind('mongo:7')).toBe('mongodb')
    expect(isDatabaseImage('nginx:1')).toBe(false)
  })

  it('maps container states to the dot', () => {
    expect(['running', 'restarting', 'paused', 'exited', 'dead', 'weird'].map(stateStatus)).toEqual(['success', 'attention', 'attention', 'idle', 'danger', 'idle'])
  })

  it('groups by Compose project in name order, the rest last as Others, running first, and filters by name or image', () => {
    const items = [
      container({ id: '1', name: 'zeta', labels: { 'com.docker.compose.project': 'shop' }, state: 'exited' }),
      container({ id: '2', name: 'alpha', labels: { 'com.docker.compose.project': 'shop' } }),
      container({ id: '3', name: 'solo', image: 'redis:7' }),
      container({ id: '4', name: 'api', labels: { 'com.docker.compose.project': 'billing' } })
    ]
    expect(groupContainers(items).map(group => [group.project, group.containers.map(item => item.name)])).toEqual([['billing', ['api']], ['shop', ['alpha', 'zeta']], [null, ['solo']]])
    expect(groupContainers(items, 'REDIS').map(group => group.project)).toEqual([null])
    expect(groupContainers(items, 'nothing')).toEqual([])
    expect(defaultSelection(items)).toBe('4')
    expect(defaultSelection([items[0]])).toBe('1')
    expect(defaultSelection([])).toBeNull()
  })

  it('reads the sizes the engines print', () => {
    expect(parseSize('84MiB')).toBe(84 * 1024 ** 2)
    expect(parseSize('1.5GB')).toBe(1.5e9)
    expect(parseSize('12B')).toBe(12)
    expect(Number.isNaN(parseSize('--'))).toBe(true)
    expect(memoryOf({ memoryUsage: '84MiB / 512MiB' })).toEqual({ used: 84 * 1024 ** 2, limit: 512 * 1024 ** 2 })
    expect(memoryOf({ memoryUsage: '-- / --' })).toBeNull()
  })

  it('finds a container stats row by name or short id', () => {
    const stats = [{ id: 'abcdefabcdef', name: 'other', cpuPercent: 1, memoryPercent: 1, memoryUsage: '', netIO: '', blockIO: '', pids: 1 }]
    expect(statFor(stats, { id: 'abcdefabcdef0000', name: 'x' })).toBe(stats[0])
    expect(statFor(stats, { id: 'ffff', name: 'other' })).toBe(stats[0])
    expect(statFor(stats, { id: 'ffff', name: 'none' })).toBeUndefined()
  })
})

describe('redacted environment', () => {
  it('keeps harmless values and drops every secret value whole', () => {
    expect(redactEnvironment(['A=1', 'API_KEY=k', 'GITHUB_TOKEN=ghp_x', 'NOTE=Bearer abcdefghijkl', 'LINK=https://u:p@host', 'EMPTY', 'A=again'])).toEqual([
      { name: 'A', value: '1' }, { name: 'API_KEY' }, { name: 'GITHUB_TOKEN' }, { name: 'NOTE' }, { name: 'LINK' }, { name: 'EMPTY', value: '' }
    ])
    expect(redactEnvironment(Array.from({ length: 300 }, (_, index) => `V${index}=x`))).toHaveLength(200)
  })
})

describe('OxePod store', () => {
  beforeEach(() => useOxePodStore.setState({ containers: [], selected: null, view: 'container', error: null, engines: [], engine: undefined, pendingPrune: null }))

  it('selects the first running container and keeps a selection that still exists', async () => {
    const api = installFakeOxeQuery()
    const a = container({ id: 'a', name: 'a', state: 'exited' }), b = container({ id: 'b', name: 'b' })
    api.on('containers.list', { engine: 'docker', containers: [a, b] })
    api.on('containers.engines', [{ engine: 'docker', available: true }])
    await useOxePodStore.getState().refresh()
    expect(useOxePodStore.getState()).toMatchObject({ selected: 'b', engine: 'docker', error: null })
    useOxePodStore.getState().select('a')
    await useOxePodStore.getState().refresh()
    expect(useOxePodStore.getState().selected).toBe('a')
    api.on('containers.list', { engine: 'docker', containers: [b] })
    await useOxePodStore.getState().refresh()
    expect(useOxePodStore.getState().selected).toBe('b')
  })

  it('reports an unreachable engine and looks at the engines again', async () => {
    const api = installFakeOxeQuery()
    api.on('containers.list', () => { throw { code: 'daemon', message: 'Docker is not running.' } })
    api.on('containers.engines', [{ engine: 'docker', available: false, state: 'stopped' }])
    await useOxePodStore.getState().refresh()
    expect(useOxePodStore.getState()).toMatchObject({ containers: [], error: 'Docker is not running.' })
    expect(api.callsOf('containers.engines')).toEqual([{ refresh: true }])
  })

  it('asks for a clean-up from the resources page and forgets it on cancel', () => {
    useOxePodStore.getState().askPrune('containers')
    expect(useOxePodStore.getState()).toMatchObject({ view: 'resources', pendingPrune: 'containers' })
    useOxePodStore.getState().askPrune(null)
    expect(useOxePodStore.getState().pendingPrune).toBeNull()
  })
})

describe('OxeQuery after the split', () => {
  beforeEach(() => useOxeQueryStore.setState({ tabs: [], activeTab: '', connections: [], dialog: { open: false, editing: null } }))

  it('starts on the welcome page and closes tabs to their neighbour', () => {
    const store = useOxeQueryStore.getState()
    expect(store.tabs).toEqual([])
    store.openConnection(connection({ id: 'a', name: 'A' }))
    store.openConnection(connection({ id: 'b', name: 'B' }))
    store.openActivity()
    expect(useOxeQueryStore.getState().tabs.map(tab => tab.id)).toEqual(['activity', 'connection:a', 'connection:b'])
    useOxeQueryStore.getState().setActiveTab('connection:a')
    useOxeQueryStore.getState().closeTab('connection:a')
    expect(useOxeQueryStore.getState().activeTab).toBe('connection:b')
    useOxeQueryStore.getState().forgetConnection('b')
    expect(useOxeQueryStore.getState().activeTab).toBe('activity')
    useOxeQueryStore.getState().closeTab('activity')
    expect(useOxeQueryStore.getState()).toMatchObject({ tabs: [], activeTab: '' })
  })

  it('opens a new connection filled in from a container, or the saved one', async () => {
    const api = installFakeOxeQuery()
    const off = onOxeQueryAction(action => performOxeQueryAction(action))
    const draft = { engine: 'postgres' as const, name: 'pg-dev', host: '127.0.0.1', port: 5432, database: 'app', username: 'app', containerRef: 'pg-dev' }
    requestOxeQueryConnect({ draft })
    await expect.poll(() => useOxeQueryStore.getState().dialog).toEqual({ open: true, editing: null, draft })
    useOxeQueryStore.getState().closeDialog()
    api.on('connections.list', [connection({ id: 'saved', name: 'pg-dev', containerRef: 'pg-dev' })])
    requestOxeQueryConnect({ connectionId: 'saved' })
    await expect.poll(() => useOxeQueryStore.getState().activeTab).toBe('connection:saved')
    expect(useOxeQueryStore.getState().dialog.open).toBe(false)
    off()
  })
})
