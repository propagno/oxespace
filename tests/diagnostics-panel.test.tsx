import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiagnosticsPanel } from '../src/components/Diagnostics/DiagnosticsPanel'
import { NewThreadDialog } from '../src/components/Threads/ThreadDialogs'
import { changeLanguage } from '../src/i18n'
import { useThreadStore } from '../src/store/thread.store'
import { registerCommands } from '../src/utils/commandRegistry'
import type { DiagnosticsIncident, DiagnosticsMetrics } from '../shared/types/diagnostics'

const GB = 1024 ** 3
const SUMMARY = '# OXESpace diagnostics\n\n- incident.mcp.quarantined (mcp): 2'

function metrics(patch: Partial<DiagnosticsMetrics> = {}): DiagnosticsMetrics {
  return {
    at: 1,
    processes: [{ kind: 'main', pid: 1, cpuPercent: 2, memoryBytes: 150e6 }, { kind: 'renderer', pid: 2, cpuPercent: 3, memoryBytes: 220e6 }],
    terminals: { running: 2, agents: 1 },
    storage: { freeBytes: 120 * GB, databaseBytes: 8e6, logsBytes: 2e6 },
    connectivity: { state: 'online', checkedAt: 1 },
    gateway: null,
    clis: [],
    accounts: [],
    mcpServers: { total: 3, healthy: 3, quarantined: 0, failing: 0 },
    ...patch
  }
}

const INCIDENTS: DiagnosticsIncident[] = [
  { id: 'i1', code: 'incident.mcp.quarantined', area: 'mcp', firstAt: Date.now() - 5000, lastAt: Date.now() - 4000, count: 2, subject: '3fa9c1d2' },
  { id: 'i2', code: 'incident.oxequery.timeout', area: 'oxequery', firstAt: Date.now() - 3000, lastAt: Date.now() - 3000, count: 1 }
]

let emit: (value: DiagnosticsMetrics) => void
let api: Record<string, ReturnType<typeof vi.fn>>
let writeText: ReturnType<typeof vi.fn>
const original = window.oxe

beforeEach(() => {
  emit = () => undefined
  writeText = vi.fn(async () => true)
  api = {
    watch: vi.fn(async () => ({ subscriptionId: 'sub-1' })),
    unwatch: vi.fn(async () => undefined),
    onMetrics: vi.fn((listener: (value: DiagnosticsMetrics) => void) => { emit = listener; return stopMetrics }),
    incidents: vi.fn(async () => INCIDENTS),
    onIncidentsChanged: vi.fn(() => () => undefined),
    clearIncidents: vi.fn(async () => undefined),
    previewBundle: vi.fn(async () => ({ files: [{ name: 'snapshot.json', bytes: 2048, summary: { code: 'bundle.file.snapshot', params: {} } }, { name: 'incidents.json', bytes: 512, summary: { code: 'bundle.file.incidents', params: {} } }], redactions: 3 })),
    exportBundle: vi.fn(async () => 'C:/out/oxespace-diagnostics.zip'),
    analysisSummary: vi.fn(async () => SUMMARY)
  }
  window.oxe = { ...original, diagnostics: { ...original?.diagnostics, ...api }, clipboard: { writeText } } as unknown as typeof window.oxe
  useThreadStore.setState({ pendingDraft: null })
})
const stopMetrics = vi.fn()
afterEach(async () => { cleanup(); window.oxe = original; stopMetrics.mockReset(); await changeLanguage('en') })

describe('Help › Diagnostics panel', () => {
  it('measures only while open: watch on mount, unwatch and stop listening on unmount', async () => {
    const view = render(<DiagnosticsPanel onLeave={() => undefined} />)
    await waitFor(() => expect(api.watch).toHaveBeenCalledWith({ intervalMs: 5000 }))
    expect(api.unwatch).not.toHaveBeenCalled()
    view.unmount()
    expect(stopMetrics).toHaveBeenCalled()
    await waitFor(() => expect(api.unwatch).toHaveBeenCalledWith({ subscriptionId: 'sub-1' }))
  })

  it('ends a subscription that answers after the panel closed', async () => {
    let answer: (value: { subscriptionId: string }) => void = () => undefined
    api.watch.mockImplementation(() => new Promise(resolve => { answer = resolve }))
    const view = render(<DiagnosticsPanel onLeave={() => undefined} />)
    view.unmount()
    await act(async () => { answer({ subscriptionId: 'late' }) })
    await waitFor(() => expect(api.unwatch).toHaveBeenCalledWith({ subscriptionId: 'late' }))
  })

  it('shows each card with a plain alert and, when something is wrong, what to do', async () => {
    render(<DiagnosticsPanel onLeave={() => undefined} />)
    await waitFor(() => expect(api.watch).toHaveBeenCalled())
    act(() => emit(metrics({ processes: [{ kind: 'renderer', pid: 2, cpuPercent: 3, memoryBytes: 3.2 * GB }], connectivity: { state: 'offline', checkedAt: 1 } })))
    const memory = await screen.findByTestId('diagnostics-card-memory')
    expect(memory).toHaveTextContent('Attention')
    expect(memory).toHaveTextContent('OXESpace is using 3.2 GB of memory.')
    expect(memory).toHaveTextContent('What to do: Close panes, conversations and OxeQuery tabs you aren\'t using.')
    expect(within(memory).getByRole('meter', { name: 'OXESpace memory use' })).toBeInTheDocument()
    const network = screen.getByTestId('diagnostics-card-network')
    expect(network).toHaveTextContent('Problem')
    expect(network).toHaveTextContent('Check Wi-Fi or the cable')
    // The heavy renderer is named in plain words under processes.
    expect(screen.getByTestId('diagnostics-card-processes')).toHaveTextContent('The interface alone is using 3.2 GB of memory.')
    // A normal card has no action.
    expect(screen.getByTestId('diagnostics-card-disk')).not.toHaveTextContent('What to do')
    expect(screen.getByTestId('diagnostics-health-summary')).toHaveTextContent('Needs attention: Network and phone, Memory, and Processes and agents.')
  })

  it('announces only when the set of alerts changes, not every measurement', async () => {
    render(<DiagnosticsPanel onLeave={() => undefined} />)
    await waitFor(() => expect(api.watch).toHaveBeenCalled())
    act(() => emit(metrics()))
    const summary = await screen.findByTestId('diagnostics-health-summary')
    expect(summary).toHaveAttribute('role', 'status')
    expect(summary).toHaveTextContent('Everything looks normal.')
    const node = summary.firstChild
    act(() => emit(metrics({ at: 2, processes: [{ kind: 'main', pid: 1, cpuPercent: 4, memoryBytes: 300e6 }] })))
    // Same words, same text node: nothing new for a screen reader.
    expect(screen.getByTestId('diagnostics-health-summary').firstChild).toBe(node)
  })

  it('lists the problem journal newest first and filters it by area', async () => {
    render(<DiagnosticsPanel onLeave={() => undefined} />)
    const list = await screen.findByTestId('diagnostics-incidents')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('An OxeQuery request ran out of time.')
    expect(items[1]).toHaveTextContent('An MCP server was quarantined after it changed.')
    expect(items[1]).toHaveTextContent('2 times')
    expect(items[1]).toHaveTextContent('What to do: Review the server\'s change in Tools › MCP servers')
    fireEvent.change(screen.getByRole('combobox', { name: 'Area' }), { target: { value: 'mcp' } })
    const filtered = within(screen.getByTestId('diagnostics-incidents')).getAllByRole('listitem')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]).toHaveTextContent('MCP servers')
  })

  it('clears the journal only after confirming', async () => {
    render(<DiagnosticsPanel onLeave={() => undefined} />)
    await screen.findByTestId('diagnostics-incidents')
    fireEvent.click(screen.getByRole('button', { name: 'Clear journal' }))
    expect(api.clearIncidents).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Clear the problem journal?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear journal' }))
    await waitFor(() => expect(api.clearIncidents).toHaveBeenCalledTimes(1))
  })

  it('translates incidents by their C3 code in pt-BR', async () => {
    await changeLanguage('pt-BR')
    render(<DiagnosticsPanel onLeave={() => undefined} />)
    const list = await screen.findByTestId('diagnostics-incidents')
    await waitFor(() => expect(list).toHaveTextContent('Um servidor MCP foi posto em quarentena depois de mudar.'))
    expect(list).toHaveTextContent('Um pedido do OxeQuery esgotou o tempo.')
    expect(list).toHaveTextContent('2 vezes')
    expect(screen.getByRole('button', { name: 'Pedir análise' })).toBeInTheDocument()
  })

  it('shows the bundle contents first and exports only after Save', async () => {
    render(<DiagnosticsPanel onLeave={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export bundle' }))
    const dialog = await screen.findByRole('dialog', { name: 'Export diagnostics bundle' })
    await within(dialog).findByText('snapshot.json')
    // Each file's summary is the C3 code's words, never the code.
    expect(dialog).toHaveTextContent('Processes, storage, connectivity and versions')
    expect(dialog).not.toHaveTextContent('bundle.file')
    expect(dialog).toHaveTextContent('3 values were redacted')
    expect(api.exportBundle).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save bundle…' }))
    await waitFor(() => expect(api.exportBundle).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Export diagnostics bundle' })).not.toBeInTheDocument())
  })

  it('keeps the preview open and says so when the save dialog is cancelled', async () => {
    api.exportBundle.mockResolvedValue(null)
    render(<DiagnosticsPanel onLeave={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export bundle' }))
    const dialog = await screen.findByRole('dialog', { name: 'Export diagnostics bundle' })
    await within(dialog).findByText('snapshot.json')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save bundle…' }))
    expect(await within(dialog).findByText('Export cancelled.')).toBeInTheDocument()
  })

  it('copies the diagnostics information', async () => {
    render(<DiagnosticsPanel onLeave={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy information' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SUMMARY))
  })

  it('asks for analysis: the summary (not the bundle) waits for a new conversation, which opens', async () => {
    const newConversation = vi.fn()
    const unregister = registerCommands('thread', [{ id: 'thread.new', label: 'New conversation', category: 'Thread', run: newConversation }])
    const onLeave = vi.fn()
    try {
      render(<DiagnosticsPanel onLeave={onLeave} />)
      fireEvent.click(screen.getByRole('button', { name: 'Ask for analysis' }))
      await waitFor(() => expect(newConversation).toHaveBeenCalledTimes(1))
      expect(api.analysisSummary).toHaveBeenCalledTimes(1)
      expect(api.previewBundle).not.toHaveBeenCalled()
      expect(api.exportBundle).not.toHaveBeenCalled()
      expect(onLeave).toHaveBeenCalled()
      expect(useThreadStore.getState().pendingDraft).toEqual({ text: SUMMARY, source: 'diagnostics' })
    } finally { unregister() }
  })
})

describe('the new conversation takes the handed-over summary', () => {
  const create = vi.fn()
  beforeEach(() => {
    create.mockReset()
    useThreadStore.setState({ projects: [{ projectId: 'p', displayName: 'repo', identityLabel: 'id', hidden: false, contexts: [{ rootPath: '/repo', label: 'repo' }] }], pendingDraft: { text: SUMMARY, source: 'diagnostics' } } as never)
    window.oxe = { ...original, thread: { ...original?.thread, create } } as typeof window.oxe
    vi.spyOn(useThreadStore.getState(), 'adopt').mockImplementation(() => undefined)
  })

  it('names it, puts it in the draft on create and sends nothing', async () => {
    create.mockResolvedValue({ thread: { id: 'new-thread' }, events: [] })
    const send = vi.fn()
    window.oxe = { ...window.oxe, thread: { ...window.oxe.thread, create, send } } as typeof window.oxe
    render(<NewThreadDialog initialProjectId="p" onClose={() => undefined} />)
    expect(screen.getByTestId('new-thread-pending-draft')).toHaveTextContent('The diagnostics summary goes into this conversation\'s draft.')
    fireEvent.click(screen.getByRole('button', { name: 'Create thread' }))
    await waitFor(() => expect(useThreadStore.getState().drafts['new-thread']).toBe(SUMMARY))
    expect(useThreadStore.getState().pendingDraft).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })

  it('drops it when the new conversation is cancelled', () => {
    render(<NewThreadDialog initialProjectId="p" onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useThreadStore.getState().pendingDraft).toBeNull()
  })
})
