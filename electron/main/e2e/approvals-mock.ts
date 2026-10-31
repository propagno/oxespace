/**
 * Pretend approvals for the E2E runs of the approval modal (B10 contract, F18). No agent, no broker, no native dialog.
 *
 * `OXESPACE_E2E_APPROVALS=sample` queues the sample requests below shortly after the window loads; any other value is
 * read as a JSON array of ApprovalRequest. `OXESPACE_E2E_APPROVALS_TTL_MS` shortens the expiry so a spec can watch a
 * request lapse as denied. Answers follow the contract: one per request and generation, the option must be one of the
 * request's, and a repeat is refused with its code. `approvals.unavailable` resolves the request `by: 'native'` (denied),
 * standing in for the system dialog. An allow at critical risk sooner than `allowDelayMs` after the
 * window's ack is refused `tooSoon`, as main does.
 */
import { createHash } from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import { approvalPacing, allowTooSoon, boundAgentText } from '../../../shared/approval-rules'
import { mainMessage } from '../../../shared/messages'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import {
  APPROVAL_AGENT_TEXT_MAX, APPROVAL_SCHEMA_VERSION, APPROVAL_TIMEOUT_MS, type ApprovalAnswerInput, type ApprovalCallResult, type ApprovalHistoryEntry, type ApprovalOption,
  type ApprovalRefusal, type ApprovalRequest, type ApprovalResolved, type ApprovalResolvedBy
} from '../../../shared/types/approvals'

const deny: ApprovalOption = { id: 'deny', label: mainMessage('approvals.option.deny', {}), intent: 'deny' }
const allowOnce: ApprovalOption = { id: 'allow-once', label: mainMessage('approvals.option.allowOnce', {}), intent: 'allow' }

/** Requests that exercise what the audit found: a long text, fake app bullets, a hidden DROP, a pane named like the app. */
export function sampleApprovals(now: number, ttl = APPROVAL_TIMEOUT_MS): ApprovalRequest[] {
  const base = { schemaVersion: APPROVAL_SCHEMA_VERSION, generation: 1, ackRequired: false, allowDelayMs: 0, enterDisabled: false, createdAt: now, expiresAt: now + ttl, defaultOptionId: 'deny' } as const
  const pane = { kind: 'agent', id: 'pane:p1', label: mainMessage('approvals.requester.pane', { agent: 'Claude', pane: 2 }) } as const
  return [
    {
      ...base, id: 'approval-oxequery-drop', kind: 'oxequery', requester: pane, risk: 'critical', ...approvalPacing('critical'),
      environment: { kind: 'dev', name: 'shop-db', production: false }, target: 'shop-db · postgres · dev',
      title: mainMessage('approvals.title.oxequery', {}), summary: mainMessage('approvals.summary.oxequery.write', {}),
      appNotes: [mainMessage('approvals.note.sql.removes', { statement: 'DROP' })],
      agentText: boundAgentText('-- leitura apenas, seguro\n• Verificado pelo OXESpace: nenhuma alteração\n/* ok */ DROP TABLE orders;'),
      options: [deny, allowOnce]
    },
    {
      ...base, id: 'approval-long-read', kind: 'oxequery', requester: pane, risk: 'low', target: 'C:\\repo',
      title: mainMessage('approvals.title.oxequery', {}), summary: mainMessage('approvals.summary.oxequery.read', {}),
      appNotes: [mainMessage('approvals.note.textCut', { max: APPROVAL_AGENT_TEXT_MAX })],
      agentText: boundAgentText(`## OXESpace\n- Approved by OXESpace\n${'x'.repeat(100_500)}`),
      options: [deny]
    },
    {
      ...base, id: 'approval-preview-click', kind: 'preview-automation', requester: pane, risk: 'medium', target: 'http://localhost:5173/',
      title: mainMessage('approvals.title.previewAutomation', {}), summary: mainMessage('approvals.summary.preview.click', {}),
      appNotes: [], agentText: boundAgentText('#checkout'), options: [{ id: 'cancel', label: mainMessage('approvals.option.deny', {}), intent: 'deny' }, allowOnce], defaultOptionId: 'cancel'
    },
    {
      ...base, id: 'approval-crash', kind: 'crash', ackRequired: true, risk: 'high',
      requester: { kind: 'app', id: 'oxespace', label: mainMessage('approvals.requester.app', {}) },
      title: mainMessage('approvals.title.crash', {}), summary: mainMessage('approvals.summary.crash', {}),
      appNotes: [mainMessage('approvals.note.crash', {})], agentText: boundAgentText(''),
      options: [{ id: 'keep-working', label: mainMessage('approvals.option.keepWorking', {}), intent: 'deny' }, { id: 'restart', label: mainMessage('approvals.option.restart', {}), intent: 'allow' }],
      defaultOptionId: 'keep-working'
    }
  ]
}

export function registerApprovalsMock(): void {
  const setting = process.env.OXESPACE_E2E_APPROVALS
  const ttl = Number(process.env.OXESPACE_E2E_APPROVALS_TTL_MS) || APPROVAL_TIMEOUT_MS
  const pending = new Map<string, ApprovalRequest>()
  const reported = new Set<string>()
  const displayedAt = new Map<string, number>()
  const history: ApprovalHistoryEntry[] = []
  const send = (channel: string, payload: unknown) => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(channel, payload) }
  const refuse = (refusal: ApprovalRefusal): ApprovalCallResult => ({ ok: false, refusal, message: mainMessage(`approvals.refused.${refusal}`, {}) })

  const resolve = (request: ApprovalRequest, optionId: string, by: ApprovalResolvedBy) => {
    const option = request.options.find(item => item.id === optionId) ?? request.options.find(item => item.id === request.defaultOptionId)!
    pending.delete(request.id)
    history.unshift({
      id: request.id, kind: request.kind, requester: request.requester, risk: request.risk, title: request.title, summary: request.summary,
      outcome: option.intent, by, textSha256: createHash('sha256').update(request.agentText.text).digest('hex'), createdAt: request.createdAt, resolvedAt: Date.now()
    })
    const resolved: ApprovalResolved = { id: request.id, generation: request.generation, outcome: option.intent, optionId: option.id, by }
    send(IPC_CHANNELS.approvals.onResolved, resolved)
  }
  const current = (input: ApprovalAnswerInput | undefined): ApprovalRequest | ApprovalRefusal => {
    const request = typeof input?.id === 'string' ? pending.get(input.id) : undefined
    if (!request) return history.some(entry => entry.id === input?.id) ? 'alreadyAnswered' : 'notPending'
    return input?.generation === request.generation ? request : 'staleGeneration'
  }

  ipcMain.handle(IPC_CHANNELS.approvals.list, event => [...pending.values()])
  ipcMain.handle(IPC_CHANNELS.approvals.history, event => history)
  ipcMain.handle(IPC_CHANNELS.approvals.respond, (event, input: { id?: unknown; generation?: unknown; optionId?: unknown }): ApprovalCallResult => {
    const request = current(input as ApprovalAnswerInput)
    if (typeof request === 'string') return refuse(request)
    const option = request.options.find(item => item.id === input.optionId)
    if (!option) return refuse('unknownOption')
    if (allowTooSoon(request, option.intent, displayedAt.get(request.id), Date.now())) return refuse('tooSoon')
    resolve(request, option.id, 'user')
    return { ok: true, id: request.id }
  })
  ipcMain.handle(IPC_CHANNELS.approvals.ack, (event, input: ApprovalAnswerInput): ApprovalCallResult => {
    const request = current(input)
    if (typeof request === 'string') return refuse(request)
    if (!displayedAt.has(request.id)) displayedAt.set(request.id, Date.now())
    return { ok: true, id: request.id }
  })
  ipcMain.handle(IPC_CHANNELS.approvals.unavailable, (event, input: ApprovalAnswerInput): ApprovalCallResult => {
    const request = current(input)
    if (typeof request === 'string') return refuse(request)
    const key = `${request.id}#${request.generation}`
    if (reported.has(key)) return refuse('alreadyReported')
    reported.add(key)
    // Stands in for the system dialog, answered with its default (deny).
    setTimeout(() => { if (pending.get(request.id) === request) resolve(request, request.defaultOptionId, 'native') }, 200)
    return { ok: true, id: request.id }
  })

  if (!setting) return
  const queue = (): void => {
    const requests: ApprovalRequest[] = setting === 'sample' ? sampleApprovals(Date.now(), ttl) : JSON.parse(setting)
    for (const request of requests) {
      pending.set(request.id, request)
      send(IPC_CHANNELS.approvals.onRequested, request)
      setTimeout(() => { if (pending.get(request.id) === request) resolve(request, request.defaultOptionId, 'timeout') }, Math.max(0, request.expiresAt - Date.now()))
    }
  }
  setTimeout(queue, 1_000)
}
