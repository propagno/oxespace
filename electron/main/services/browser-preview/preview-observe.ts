import { redactSecrets } from '../../../../shared/secrets'
import type {
  BrowserPreviewConsoleRow,
  BrowserPreviewNetworkRow
} from '../../../../shared/types/browser-preview'

export interface CdpEvent {
  method: string
  params?: Record<string, unknown>
}

export interface PreviewStepInput {
  action: 'navigate' | 'click' | 'fill' | 'scroll'
  url?: string
  target?: { label: string; type?: string | null } | null
  text?: string
}

export interface PreviewStep {
  kind: 'navigate' | 'click' | 'fill' | 'scroll'
  label: string | null
  value?: string
}

const MAX_CONSOLE_CHARS = 500
const MAX_FILL_CHARS = 80
const MAX_NETWORK_ROWS = 200

export function maskPreviewUrl(raw: string): string {
  if (!raw) return ''
  if (/^data:/i.test(raw)) {
    const match = /^data:([^;,?#\s]*)/i.exec(raw)
    return match && match[1] ? `data:${match[1]}` : 'data:'
  }
  if (/^blob:/i.test(raw)) {
    return 'blob:'
  }
  try {
    const parsed = new URL(raw)
    const base = `${parsed.protocol}//${parsed.host}${parsed.pathname}`
    if (parsed.search.length <= 1) return base
    const maskedQuery = [...parsed.searchParams.keys()]
      .map(key => `${encodeURIComponent(key)}=•••`)
      .join('&')
    return maskedQuery ? `${base}?${maskedQuery}` : base
  } catch {
    const withoutHash = raw.split('#')[0] ?? ''
    const qIndex = withoutHash.indexOf('?')
    if (qIndex < 0) return redactSecrets(withoutHash)
    const base = redactSecrets(withoutHash.slice(0, qIndex))
    const query = withoutHash.slice(qIndex + 1)
    const keys = query
      .split('&')
      .filter(Boolean)
      .map(part => `${part.split('=')[0]}=•••`)
      .join('&')
    return keys ? `${base}?${keys}` : base
  }
}

function formatConsoleArg(arg: unknown): string {
  if (!arg || typeof arg !== 'object') return String(arg ?? '')
  const record = arg as Record<string, unknown>
  if ('value' in record && record.value !== undefined) return String(record.value)
  if (typeof record.description === 'string') return record.description
  if (typeof record.unserializableValue === 'string') return record.unserializableValue
  return ''
}

export function consoleRow(cdpEvent: CdpEvent): BrowserPreviewConsoleRow | null {
  const params = cdpEvent.params ?? {}
  if (cdpEvent.method === 'Runtime.consoleAPICalled') {
    const rawType = typeof params.type === 'string' ? params.type : 'log'
    const level: BrowserPreviewConsoleRow['level'] =
      rawType === 'error' || rawType === 'assert'
        ? 'error'
        : rawType === 'warning' || rawType === 'warn'
          ? 'warning'
          : 'info'
    const args = Array.isArray(params.args) ? params.args : []
    const joined = args.map(formatConsoleArg).join(' ')
    const message = redactSecrets(joined).slice(0, MAX_CONSOLE_CHARS)
    const stackTrace = params.stackTrace as
      | { callFrames?: Array<{ url?: unknown; lineNumber?: unknown }> }
      | undefined
    const frame = stackTrace?.callFrames?.[0]
    const source = typeof frame?.url === 'string' && frame.url ? maskPreviewUrl(frame.url) : ''
    const line = typeof frame?.lineNumber === 'number' ? frame.lineNumber + 1 : 0
    return { level, message, source, line }
  }

  if (cdpEvent.method === 'Log.entryAdded') {
    const entry = (params.entry && typeof params.entry === 'object' ? params.entry : {}) as {
      level?: unknown
      text?: unknown
      url?: unknown
      lineNumber?: unknown
    }
    const level: BrowserPreviewConsoleRow['level'] =
      entry.level === 'error' ? 'error' : entry.level === 'warning' ? 'warning' : 'info'
    const message = redactSecrets(typeof entry.text === 'string' ? entry.text : '').slice(0, MAX_CONSOLE_CHARS)
    const source = typeof entry.url === 'string' && entry.url ? maskPreviewUrl(entry.url) : ''
    const line = typeof entry.lineNumber === 'number' ? entry.lineNumber + 1 : 0
    return { level, message, source, line }
  }

  return null
}

interface InternalNetworkEntry {
  row: BrowserPreviewNetworkRow
  startTs: number | null
}

export class NetworkLog {
  private readonly entries: InternalNetworkEntry[] = []
  private readonly inFlight = new Map<string, InternalNetworkEntry>()

  private push(entry: InternalNetworkEntry): void {
    this.entries.push(entry)
    while (this.entries.length > MAX_NETWORK_ROWS) {
      const oldest = this.entries.shift()
      if (!oldest) break
      for (const [id, active] of this.inFlight) {
        if (active === oldest) this.inFlight.delete(id)
      }
    }
  }

  add(cdpEvent: CdpEvent): BrowserPreviewNetworkRow | null {
    const { method, params = {} } = cdpEvent

    if (method === 'Network.webSocketCreated') {
      const url = typeof params.url === 'string' ? maskPreviewUrl(params.url) : ''
      const row: BrowserPreviewNetworkRow = {
        method: 'GET',
        url,
        status: 101,
        type: 'websocket',
        ms: null
      }
      this.push({ row, startTs: null })
      return { ...row }
    }

    if (method === 'Network.requestWillBeSent') {
      const requestId = typeof params.requestId === 'string' ? params.requestId : ''
      if (!requestId) return null
      const ts = typeof params.timestamp === 'number' ? params.timestamp : null

      if (params.redirectResponse && typeof params.redirectResponse === 'object') {
        const previous = this.inFlight.get(requestId)
        if (previous) {
          const redir = params.redirectResponse as { status?: unknown }
          previous.row.status = typeof redir.status === 'number' ? redir.status : 302
          if (previous.startTs !== null && ts !== null) {
            previous.row.ms = Math.max(0, Math.round((ts - previous.startTs) * 1000))
          }
          this.inFlight.delete(requestId)
        }
      }

      const request = (params.request && typeof params.request === 'object' ? params.request : {}) as {
        method?: unknown
        url?: unknown
      }
      const reqMethod = typeof request.method === 'string' && request.method ? request.method : 'GET'
      const reqUrl = typeof request.url === 'string' ? maskPreviewUrl(request.url) : ''
      const resType = typeof params.type === 'string' && params.type ? params.type.toLowerCase() : 'other'

      const entry: InternalNetworkEntry = {
        row: {
          method: reqMethod,
          url: reqUrl,
          status: null,
          type: resType,
          ms: null
        },
        startTs: ts
      }
      this.inFlight.set(requestId, entry)
      this.push(entry)
      return { ...entry.row }
    }

    if (method === 'Network.responseReceived') {
      const requestId = typeof params.requestId === 'string' ? params.requestId : ''
      const entry = requestId ? this.inFlight.get(requestId) : undefined
      if (!entry) return null
      const response = (params.response && typeof params.response === 'object' ? params.response : {}) as {
        status?: unknown
      }
      if (typeof response.status === 'number') entry.row.status = response.status
      if (typeof params.type === 'string' && params.type) entry.row.type = params.type.toLowerCase()
      return { ...entry.row }
    }

    if (method === 'Network.loadingFinished') {
      const requestId = typeof params.requestId === 'string' ? params.requestId : ''
      const entry = requestId ? this.inFlight.get(requestId) : undefined
      if (!entry) return null
      const ts = typeof params.timestamp === 'number' ? params.timestamp : null
      if (entry.startTs !== null && ts !== null) {
        entry.row.ms = Math.max(0, Math.round((ts - entry.startTs) * 1000))
      }
      this.inFlight.delete(requestId)
      return { ...entry.row }
    }

    if (method === 'Network.loadingFailed') {
      const requestId = typeof params.requestId === 'string' ? params.requestId : ''
      const entry = requestId ? this.inFlight.get(requestId) : undefined
      if (!entry) return null
      const ts = typeof params.timestamp === 'number' ? params.timestamp : null
      entry.row.status = null
      if (entry.startTs !== null && ts !== null) {
        entry.row.ms = Math.max(0, Math.round((ts - entry.startTs) * 1000))
      }
      entry.row.failed = params.canceled === true ? 'canceled' : 'error'
      this.inFlight.delete(requestId)
      return { ...entry.row }
    }

    return null
  }

  rows(): BrowserPreviewNetworkRow[] {
    return this.entries.map(entry => ({ ...entry.row }))
  }
}

export function previewStep(input: PreviewStepInput): PreviewStep {
  if (input.action === 'navigate') {
    let pathname: string
    try {
      pathname = new URL(input.url ?? '').pathname || '/'
    } catch {
      pathname = (input.url ?? '').split(/[?#]/)[0] || '/'
    }
    return { kind: 'navigate', label: pathname }
  }

  if (input.action === 'click') {
    return { kind: 'click', label: input.target?.label ?? '' }
  }

  if (input.action === 'fill') {
    const isPassword = input.target?.type?.toLowerCase() === 'password'
    const value = isPassword
      ? '••••'
      : redactSecrets(input.text ?? '').slice(0, MAX_FILL_CHARS)
    return { kind: 'fill', label: input.target?.label ?? '', value }
  }

  return { kind: 'scroll', label: input.target?.label ?? null }
}
