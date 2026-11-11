import { AlertTriangle, AlertCircle, Info } from 'lucide-react'
import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  BrowserPreviewAgentAction,
  BrowserPreviewConsoleRow,
  BrowserPreviewEvent,
  BrowserPreviewGrant,
  BrowserPreviewNetworkRow
} from '../../../shared/types/browser-preview'
import { Avatar, Badge, Button, toast } from '../../ui'
import './AgentBrowserChrome.css'

export interface AgentBrowserChromeProps {
  ownerKey: string
  tabId: string
  agentName: string
  footerLeft?: ReactElement | null
  children?: ReactNode
}

const MAX_STEPS = 20
const MAX_CONSOLE_ROWS = 200
const MAX_NETWORK_ROWS = 200

function isConsoleRow(row: unknown): row is BrowserPreviewConsoleRow {
  return Boolean(row && typeof row === 'object' && 'level' in row && 'message' in row)
}

function isNetworkRow(row: unknown): row is BrowserPreviewNetworkRow {
  return Boolean(row && typeof row === 'object' && 'method' in row && 'url' in row)
}

export function AgentBrowserChrome({ ownerKey, tabId, agentName, footerLeft = null, children }: AgentBrowserChromeProps): ReactElement {
  const { t } = useTranslation('code')
  const [grant, setGrant] = useState<BrowserPreviewGrant | null>(null)
  const [steps, setSteps] = useState<BrowserPreviewAgentAction[]>([])
  const [consoleRows, setConsoleRows] = useState<BrowserPreviewConsoleRow[]>([])
  const [networkRows, setNetworkRows] = useState<BrowserPreviewNetworkRow[]>([])
  const [devToolsOpen, setDevToolsOpen] = useState(false)
  const [drawer, setDrawer] = useState<'console' | 'network' | null>(null)

  useEffect(() => {
    setGrant(null)
    setSteps([])
    setConsoleRows([])
    setNetworkRows([])
    setDevToolsOpen(false)
  }, [ownerKey, tabId])

  useEffect(() => {
    const subscribe = window.oxe?.browserPreview?.onEvent
    if (!subscribe) return undefined
    return subscribe((event: BrowserPreviewEvent) => {
      if (event.ownerKey !== ownerKey || event.tabId !== tabId) return
      if (event.type === 'grant') {
        setGrant(event.grant ?? null)
        return
      }
      if (event.type === 'broker') {
        setDevToolsOpen(event.devToolsOpen === true)
        return
      }
      if (event.type === 'agent-action' && event.action) {
        const incoming = event.action
        if (event.result === 'denied') return
        setSteps(current => {
          const existingIndex = current.findIndex(item => item.id === incoming.id)
          if (existingIndex >= 0) {
            const next = [...current]
            next[existingIndex] = incoming
            return next
          }
          return [...current, incoming].slice(-MAX_STEPS)
        })
        return
      }
      if (event.type === 'console' && isConsoleRow(event.row)) {
        const clean: BrowserPreviewConsoleRow = {
          level: event.row.level,
          message: event.row.message,
          source: event.row.source,
          line: event.row.line
        }
        setConsoleRows(current => [...current, clean].slice(-MAX_CONSOLE_ROWS))
        return
      }
      if (event.type === 'network' && isNetworkRow(event.row)) {
        const clean: BrowserPreviewNetworkRow = {
          method: event.row.method,
          url: event.row.url,
          status: event.row.status,
          type: event.row.type,
          ms: event.row.ms,
          ...(event.row.failed ? { failed: event.row.failed } : {})
        }
        setNetworkRows(current => [...current, clean].slice(-MAX_NETWORK_ROWS))
      }
    })
  }, [ownerKey, tabId])

  const handleEnd = async (): Promise<void> => {
    await window.oxe?.browserPreview?.revokeGrant?.({ ownerKey, tabId })
    setGrant(null)
    toast({ title: t('agentBrowser.revokedToast', { agent: agentName }) })
  }

  const formatStep = (step: BrowserPreviewAgentAction): string => {
    if (step.kind === 'navigate') return t('agentBrowser.stepOpened', { target: step.label })
    if (step.kind === 'click') return t('agentBrowser.stepClicked', { label: step.label })
    if (step.kind === 'fill') {
      return step.value !== undefined
        ? t('agentBrowser.stepFilled', { label: step.label, value: step.value })
        : t('agentBrowser.stepFilledNoValue', { label: step.label })
    }
    return step.label
      ? t('agentBrowser.stepScrolled', { label: step.label })
      : t('agentBrowser.stepScrolledPlain')
  }

  const errorCount = consoleRows.filter(row => row.level === 'error').length
  const sessionScope = grant?.scope === 'session'

  return (
    <div className="agent-browser-chrome">
      {grant ? (
        <div className="agent-browser-strip" role="status">
          <Avatar name={agentName} size={20} />
          <span className="agent-browser-strip-text">{t('agentBrowser.usingPage', { agent: agentName })}</span>
          <span
            className="agent-browser-scope-chip"
            data-tone={sessionScope ? 'info' : 'attn'}
            title={sessionScope ? t('agentBrowser.scopeSessionHint') : t('agentBrowser.scopeActionHint')}
          >
            {sessionScope ? t('agentBrowser.scopeSession') : t('agentBrowser.scopeAction')}
          </span>
          <span className="agent-browser-strip-spacer" />
          <Button variant="secondary" size="sm" onClick={() => void handleEnd()}>
            {t('agentBrowser.end')}
          </Button>
        </div>
      ) : null}

      {devToolsOpen ? (
        <div className="agent-browser-devtools-note" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{t('agentBrowser.devToolsOpen')}</span>
        </div>
      ) : null}

      {children}
      {drawer === 'console' ? (
        <div className="agent-browser-drawer">
          {consoleRows.length === 0 ? (
            <p className="agent-browser-drawer-blank">{t('agentBrowser.emptyLog')}</p>
          ) : (
            <ul className="agent-browser-log-list" role="list">
              {consoleRows.map((row, index) => (
                <li key={index} className="agent-browser-console-row" data-level={row.level}>
                  {row.level === 'error' ? (
                    <AlertCircle size={12} aria-hidden="true" />
                  ) : row.level === 'warning' ? (
                    <AlertTriangle size={12} aria-hidden="true" />
                  ) : (
                    <Info size={12} aria-hidden="true" />
                  )}
                  <span className="agent-browser-console-msg">{row.message}</span>
                  {row.source ? (
                    <span className="agent-browser-console-loc">
                      {row.line > 0 ? `${row.source}:${row.line}` : row.source}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {drawer === 'network' ? (
        <div className="agent-browser-drawer">
          {networkRows.length === 0 ? (
            <p className="agent-browser-drawer-blank">{t('agentBrowser.emptyLog')}</p>
          ) : (
            <ul className="agent-browser-log-list" role="list">
              {networkRows.map((row, index) => (
                <li key={index} className="agent-browser-network-row">
                  <Badge>{row.method}</Badge>
                  <span className="agent-browser-network-url">{row.url}</span>
                  <Badge intent={row.status !== null && row.status >= 400 ? 'danger' : undefined}>
                    {row.status !== null ? String(row.status) : row.failed ?? '—'}
                  </Badge>
                  <span className="agent-browser-network-meta">{row.type}</span>
                  {row.ms !== null ? (
                    <span className="agent-browser-network-meta">{t('agentBrowser.ms', { ms: row.ms })}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="agent-browser-footer">
        {steps.length > 0 ? (
          <ul className="agent-browser-steps" role="list" aria-label={t('agentBrowser.stepsLabel')}>
            {steps.map((step, index) => (
              <li
                key={step.id}
                className="agent-browser-step"
                aria-current={index === steps.length - 1 ? 'step' : undefined}
              >
                {formatStep(step)}
              </li>
            ))}
          </ul>
        ) : (
          footerLeft
        )}
        <div className="agent-browser-chips">
          <Button
            variant="ghost"
            size="sm"
            className="agent-browser-chip"
            aria-pressed={drawer === 'console'}
            onClick={() => setDrawer(current => (current === 'console' ? null : 'console'))}
          >
            <span>{t('agentBrowser.console')}</span>
            {errorCount > 0 ? <Badge intent="danger">{errorCount}</Badge> : null}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="agent-browser-chip"
            aria-pressed={drawer === 'network'}
            onClick={() => setDrawer(current => (current === 'network' ? null : 'network'))}
          >
            <span>{t('agentBrowser.network')}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
