import { AlertCircle, ArrowLeft, ArrowRight, Camera, ExternalLink, MousePointerClick, Minus, Monitor, MonitorPlay, Plus, RotateCw, Smartphone, Tablet, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ToolPanel, Button, EmptyState, ErrorState, Spinner } from '../../ui'
import type { DesignGrabPayload } from '../../../shared/types/design-mode'
import type { BrowserPreviewEvent, BrowserPreviewSessionState } from '../../../shared/types/browser-preview'
import type { Workspace } from '../../../shared/types/workspace'
import { pasteIntoAgentTerminal } from '../../lib/sendToAgent'
import { openExternalLink } from '../../lib/externalLinks'
import { ConfirmDialog } from '../../ui'
import { useUIStore } from '../../store/ui.store'
import { DesignGrabSheet } from './DesignGrabSheet'
import { NativePreviewHost } from './NativePreviewHost'
import { humanizeError } from '../../utils/humanizeError'
import { useTranslation } from 'react-i18next'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

interface WebPreviewPanelProps {
  workspace: Workspace
  threadId?: string
  onRunCommand: (command: string) => void
  onClose: () => void
  embedded?: boolean
  onSendToAgent?: (prompt: string) => void | Promise<void>
}

const DEFAULT_URL = 'http://localhost:3000'

type Viewport = 'desktop' | 'tablet' | 'mobile'
interface PreviewTab { id: string; draftUrl: string; url: string | null; loading: boolean; error: string | null; canGoBack: boolean; canGoForward: boolean }

const VIEWPORTS: Record<Viewport, { width: number | null; height: number | null }> = {
  desktop: { width: null, height: null },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 }
}

export function WebPreviewPanel({ embedded = false, onClose, onSendToAgent, workspace, threadId }: WebPreviewPanelProps): ReactElement {
  const { t } = useTranslation('code')
  const previewKey = threadId ? `thread:${threadId}` : workspace.id
  const [tabs, setTabs] = useState<PreviewTab[]>([])
  const [activeTabId, setActiveTabId] = useState('')
  const activeTab = tabs.find(tab => tab.id === activeTabId) ?? {id:'',draftUrl:DEFAULT_URL,url:null,loading:false,error:null,canGoBack:false,canGoForward:false}
  const { draftUrl, url, loading, error: pageError, canGoBack, canGoForward } = activeTab
  const updateTab = (id: string, update: (tab: PreviewTab) => PreviewTab): void => setTabs(current => current.map(tab => tab.id === id ? update(tab) : tab))
  const applySession = useCallback((session: BrowserPreviewSessionState): void => {
    setTabs(current => session.tabs.map(tab => {
      const previous = current.find(item => item.id === tab.id)
      return {id:tab.id,url:tab.url,draftUrl:previous?.draftUrl ?? tab.url ?? DEFAULT_URL,loading:tab.loading,error:tab.error,canGoBack:tab.canGoBack,canGoForward:tab.canGoForward}
    }))
    setActiveTabId(session.activeTabId)
  },[])
  useEffect(() => {
    let cancelled = false
    setTabs([])
    setActiveTabId('')
    void window.oxe.browserPreview.session({ownerKey:previewKey,action:'open'}).then(session => { if (!cancelled) applySession(session) }).catch(error => { if (!cancelled) setCaptureNotice(humanizeError(error, tc('preview.error.tabs'))) })
    return () => { cancelled = true }
  },[previewKey,applySession])
  const setDraftUrl = (value: string): void => updateTab(activeTabId, tab => ({ ...tab, draftUrl: value }))
  const [zoom, setZoom] = useState(100)
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [captureNotice, setCaptureNotice] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [allowExternal, setAllowExternal] = useState(false)
  const externalPageBlocked = Boolean(url && !normalizePreviewUrl(url, allowExternal))
  const [agentDocumentation, setAgentDocumentation] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  // #3 Design Mode: pick an element in the previewed page and hand it to an agent.
  const [designMode, setDesignMode] = useState(false)
  // Escape first leaves Design Mode (the hint says so), then closes the panel.
  const [grab, setGrab] = useState<{ payload: DesignGrabPayload; screenshot: string | null } | null>(null)
  // `send()` and `capturePage()` throw until the guest emits dom-ready.
  const [guestReady, setGuestReady] = useState(false)
  const readyTabs = useRef(new Set<string>())
  const normalizedUrl = useMemo(() => normalizePreviewUrl(draftUrl, allowExternal), [draftUrl, allowExternal])
  const canOpen = normalizedUrl !== null
  const open = (): void => {
    if (!activeTabId) return
    if (!normalizedUrl) {
      setCaptureNotice(allowExternal ? tc('preview.invalidUrl') : tc('preview.localOnly'))
      return
    }
    const nextUrl = normalizedUrl
    void window.oxe.browserPreview.session({ownerKey:previewKey,action:'navigate',tabId:activeTabId,url:nextUrl,allowExternal}).then(applySession).catch(error => setCaptureNotice(humanizeError(error, tc('preview.error.open'))))
  }

  const goBack = (): void => {
    if (!canGoBack) return
    void window.oxe.browserPreview.back({ownerKey:previewKey,tabId:activeTabId}).catch(error => setCaptureNotice(humanizeError(error, tc('preview.error.back'))))
  }

  const goForward = (): void => {
    if (!canGoForward) return
    void window.oxe.browserPreview.forward({ownerKey:previewKey,tabId:activeTabId}).catch(error => setCaptureNotice(humanizeError(error, tc('preview.error.forward'))))
  }

  const reload = (): void => { void window.oxe.browserPreview.reload({ownerKey:previewKey,tabId:activeTabId}).catch(error => setCaptureNotice(humanizeError(error, tc('preview.error.reload')))) }
  const changeTab = (action:'new'|'select'|'close',tabId?:string): void => {
    void window.oxe.browserPreview.session({ownerKey:previewKey,action,tabId}).then(applySession).catch(error => setCaptureNotice(humanizeError(error, tc('preview.error.tabs'))))
    setDesignMode(false)
  }

  // Native guest events arrive from the owning BrowserWindow; ignore other tabs.
  useEffect(() => {
    return window.oxe.browserPreview.onEvent((event: BrowserPreviewEvent) => {
      if (event.ownerKey !== previewKey) return
      if (event.type === 'session' && event.session) { applySession(event.session); return }
      if (event.type === 'navigation' && event.url) updateTab(event.tabId, tab => ({...tab,draftUrl:event.url!,url:event.url!,error:null,canGoBack:event.canGoBack === true,canGoForward:event.canGoForward === true}))
      if (event.type === 'loading') updateTab(event.tabId, tab => ({...tab,loading:event.loading === true,error:event.loading ? null : tab.error}))
      if (event.type === 'failed') updateTab(event.tabId, tab => ({...tab,loading:false,error:event.message ?? tc('preview.pageFailed')}))
      if (event.tabId !== activeTabId) return
      if (event.type === 'ready') { readyTabs.current.add(event.tabId); setGuestReady(true) }
      if (event.type === 'loading' && event.loading) { readyTabs.current.delete(event.tabId); setGuestReady(false) }
      if (event.type === 'cancel') {
        setDesignMode(false)
        return
      }
      if (event.type !== 'grab' || !event.payload) return
      const payload = event.payload
      setDesignMode(false)
      void window.oxe.browserPreview.captureElement({ownerKey:previewKey,tabId:activeTabId,rect:payload.rect})
        .then((screenshot) => setGrab({ payload, screenshot }))
        .catch(() => setGrab({ payload, screenshot: null }))
    })
  }, [previewKey, activeTabId, applySession])

  // A new document means a fresh guest with the picker off.
  useEffect(() => {
    setGuestReady(readyTabs.current.has(activeTabId))
    setDesignMode(false)
  }, [url, activeTabId])

  // Keep the guest in sync with the toggle, including after a reload.
  useEffect(() => {
    if (!guestReady) return
    void window.oxe.browserPreview.designMode({ownerKey:previewKey,tabId:activeTabId,enabled:designMode}).catch(() => {})
  }, [designMode, guestReady, previewKey, activeTabId])

  useEffect(() => {
    for (const tab of tabs) if (tab.url) void window.oxe.browserPreview.setAccess({ownerKey:previewKey,tabId:tab.id,agentAccess:agentDocumentation,allowExternal}).catch(() => {})
  }, [tabs, previewKey, agentDocumentation, allowExternal])

  const toggleDesignMode = useCallback((): void => {
    if (!url || !guestReady) {
      setCaptureNotice(tc('preview.designWait'))
      return
    }
    setDesignMode((value) => !value)
  }, [url, guestReady])

  const sendGrabToAgent = useCallback(
    async (prompt: string): Promise<void> => {
      if (onSendToAgent) {
        await onSendToAgent(prompt)
        setGrab(null)
        setCaptureNotice(tc('preview.addedToDraft'))
        return
      }
      const result = await pasteIntoAgentTerminal(workspace.id, prompt)
      setGrab(null)
      setCaptureNotice(result.message)
    },
    [onSendToAgent, workspace.id]
  )

  // Watch this workspace's pending preview slot — populated by App.tsx when
  // `oxespace_open_web_preview` tool was invoked. Two layers: (a) the panel
  // may be already mounted and listening live; (b) the panel may have just
  // mounted because of the auto-open in App.tsx — in either case, this hook
  // sees the new pending URL and loads it. Entries are workspace-keyed so an
  // agent opening one preview cannot overwrite another workspace's request.
  const pendingWebPreview = useUIStore((s) => s.pendingWebPreviewByWorkspace[previewKey] ?? null)
  const setPendingWebPreview = useUIStore((s) => s.setPendingWebPreview)
  useEffect(() => {
    if (!pendingWebPreview || !activeTabId) return
    const nextUrl = normalizePreviewUrl(pendingWebPreview, allowExternal)
    if (!nextUrl) {
      setCaptureNotice(tc('preview.agentExternal'))
      return
    }
    setCaptureNotice(null)
    updateTab(activeTabId, tab => ({ ...tab, draftUrl: pendingWebPreview }))
    void window.oxe.browserPreview.session({ownerKey:previewKey,action:'navigate',tabId:activeTabId,url:nextUrl,allowExternal}).then(session => { applySession(session); setPendingWebPreview(previewKey, null) }).catch(error => setCaptureNotice(humanizeError(error, tc('preview.error.open'))))
  }, [pendingWebPreview, previewKey, activeTabId, setPendingWebPreview, allowExternal, applySession])
  const zoomOut = (): void => setZoom((value) => Math.max(50, value - 10))
  const zoomIn = (): void => setZoom((value) => Math.min(150, value + 10))
  const openExternal = (): void => { if (url) void openExternalLink(url, { source: 'preview' }) }
  const viewportConfig = VIEWPORTS[viewport]
  const handleCapture = async (): Promise<void> => {
    if (!url || capturing) return
    setCapturing(true)
    setCaptureNotice(null)
    try {
      await window.oxe.browserPreview.captureClipboard({ownerKey:previewKey,tabId:activeTabId})
      setCaptureNotice(tc('preview.copied'))
    } catch (error) {
      setCaptureNotice(humanizeError(error, tc('preview.error.capture')))
    } finally {
      setCapturing(false)
    }
  }

  const content = (
    <>
      <header className="web-preview-header">
        <div className="web-preview-title">
          <MonitorPlay size={14} aria-hidden="true" />
          <strong>{t('panels.browser')}</strong>
          <span>{workspace.name}</span>
        </div>
        <div className="web-preview-actions">
          {!embedded ? (
            <Button variant="ghost" size="sm" square aria-label={t('preview.close')} onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="web-preview-tabs" role="group" aria-label={t('preview.tabs')}>
        {tabs.map((tab, index) => <div className="web-preview-tab" key={tab.id} data-browser-tab-id={tab.id} data-active={tab.id === activeTabId} data-loading={tab.loading} data-error={Boolean(tab.error)}>
          {tab.loading ? <Spinner size="sm" label={t('preview.tabLoading')} /> : tab.error ? <AlertCircle size={12} role="img" aria-label={t('preview.tabFailed')} /> : null}
          <button type="button" aria-current={tab.id === activeTabId ? 'true' : undefined} aria-label={t('preview.tab', { index: index + 1, name: tab.url ? new URL(tab.url).hostname : t('preview.newTab') })} onClick={() => changeTab('select',tab.id)}>{tab.url ? new URL(tab.url).hostname : t('preview.newTab')}</button>
          <button type="button" aria-label={t('preview.closeTab', { index: index + 1 })} onClick={() => changeTab('close',tab.id)}><X size={12} aria-hidden="true" /></button>
        </div>)}
        <button type="button" className="web-preview-new-tab" aria-label={t('preview.newTabLabel')} title={t('preview.newTabLabel')} onClick={() => changeTab('new')}><Plus size={14} aria-hidden="true" /></button>
      </div>

      <div className="web-preview-browserbar" role="toolbar" aria-label={t('preview.toolbar')}>
        <button type="button" className="web-preview-nav-button" aria-label={t('preview.back')} title={t('preview.back')} disabled={!canGoBack} onClick={goBack}>
          <ArrowLeft size={14} aria-hidden="true" />
        </button>
        <button type="button" className="web-preview-nav-button" aria-label={t('preview.forward')} title={t('preview.forward')} disabled={!canGoForward} onClick={goForward}>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        <button type="button" className="web-preview-nav-button" aria-label={t('preview.reload')} title={t('preview.reload')} disabled={!url} onClick={reload}>
          <RotateCw size={14} aria-hidden="true" />
        </button>
        <input
          className="web-preview-address-input"
          aria-label={t('preview.address')}
          disabled={!activeTabId}
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') open() }}
          placeholder="http://localhost:3000"
          spellCheck={false}
        />
        <button type="button" className="web-preview-go-button" disabled={!canOpen || !activeTabId} onClick={open}>
          {t('preview.go')}
        </button>
        <label className="web-preview-external-toggle" title={t('preview.externalTitle')}>
          <input type="checkbox" checked={allowExternal} onChange={(event) => setAllowExternal(event.currentTarget.checked)} />
          {t('preview.external')}
        </label>
        <div className="web-preview-zoom-controls" role="group" aria-label={t('preview.zoom')}>
          <button type="button" aria-label={t('preview.zoomOut')} title={t('preview.zoomOut')} onClick={zoomOut}><Minus size={14} aria-hidden="true" /></button>
          <span>{zoom}%</span>
          <button type="button" aria-label={t('preview.zoomIn')} title={t('preview.zoomIn')} onClick={zoomIn}><Plus size={14} aria-hidden="true" /></button>
        </div>
        <button type="button" className="web-preview-nav-button" aria-label={t('preview.viewport.desktop')} title={t('preview.viewport.desktop')} aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}><Monitor size={14} aria-hidden="true" /></button>
        <button type="button" className="web-preview-nav-button" aria-label={t('preview.viewport.tablet')} title={t('preview.viewport.tablet')} aria-pressed={viewport === 'tablet'} onClick={() => setViewport('tablet')}><Tablet size={14} aria-hidden="true" /></button>
        <button type="button" className="web-preview-nav-button" aria-label={t('preview.viewport.mobile')} title={t('preview.viewport.mobile')} aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}><Smartphone size={14} aria-hidden="true" /></button>
        <button
          type="button"
          className={`web-preview-nav-button${designMode ? ' active' : ''}`}
          aria-label={t('preview.design')}
          aria-pressed={designMode}
          title={t('preview.designTitle')}
          data-testid="design-mode-toggle"
          disabled={!url || !guestReady}
          onClick={toggleDesignMode}
        >
          <MousePointerClick size={14} aria-hidden="true" />
        </button>
        <button type="button" className="web-preview-nav-button" aria-label={t('preview.capture')} title={t('preview.capture')} disabled={!url || capturing} onClick={() => void handleCapture()}><Camera size={14} aria-hidden="true" /></button>
        <button type="button" className="web-preview-nav-button" aria-label={t('preview.openExternal')} title={t('preview.openExternal')} disabled={!url} onClick={openExternal}>
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      </div>

      {consentOpen && <ConfirmDialog title={t('preview.access.title')} confirmLabel={t('preview.access.allow')} onCancel={() => setConsentOpen(false)}
        onConfirm={() => { setAgentDocumentation(true); setConsentOpen(false) }}
        description={t('preview.access.body')} />}
      <div className="web-preview-agent-access">
        <label className="web-preview-external-toggle" title={t('preview.access.toggleTitle')}>
          <input type="checkbox" aria-label={t('preview.access.toggleLabel')} checked={agentDocumentation} onChange={event => {
            if (!event.currentTarget.checked) { setAgentDocumentation(false); return }
            setConsentOpen(true)
          }} />{t('preview.access.toggle')}
        </label>
        <span>{agentDocumentation ? t('preview.access.on') : t('preview.access.off')}</span>
      </div>

      <div className="web-preview-stage" aria-busy={loading}>
        {tabs.map(tab => tab.url && !tab.error && normalizePreviewUrl(tab.url, allowExternal) && <div className="web-preview-frame-wrap" key={tab.id} style={tab.id === activeTabId ? undefined : { display: 'none' }}>
            <div
              className={`web-preview-device viewport-${viewport}`}
              style={{
                width: viewportConfig.width ? `${viewportConfig.width}px` : '100%',
                height: viewportConfig.height ? `${viewportConfig.height}px` : '100%',
                maxHeight: '100%'
              }}
            >
              <div className="web-preview-device-bar">
                <span>{viewportConfig.width ? t('preview.viewport.size', { name: t(`preview.viewport.${viewport}`), width: viewportConfig.width }) : t(`preview.viewport.${viewport}`)}</span>
                <code>{url}</code>
              </div>
              <NativePreviewHost key={tab.id} mount={{ownerKey:previewKey,workspaceId:workspace.id,threadId,tabId:tab.id,url:tab.url,allowExternal,agentAccess:agentDocumentation}} active={tab.id === activeTabId} zoom={zoom} />
            </div>
          </div>)}
        {(!url || externalPageBlocked || pageError) && (
          <div className="web-preview-placeholder">
            {externalPageBlocked ? <EmptyState icon={<MonitorPlay size={20} />} title={t('preview.externalRequired')}>{t('preview.externalRequiredHint')}</EmptyState>
              : pageError ? <ErrorState title={t('preview.unavailable')} message={t('preview.unavailableHint')} detail={pageError} onRetry={open} retryLabel={t('preview.retry')} />
              : <EmptyState icon={<MonitorPlay size={20} />} title={t('panels.browser')}>{t('preview.emptyHint')}</EmptyState>}
          </div>
        )}
      </div>
      {designMode ? (
        <div className="web-preview-design-hint" role="status">
          {t('preview.designHint')}
        </div>
      ) : null}
      {grab ? (
        <DesignGrabSheet
          payload={grab.payload}
          screenshot={grab.screenshot}
          onSend={(prompt) => void sendGrabToAgent(prompt)}
          onDismiss={() => setGrab(null)}
        />
      ) : null}
      {captureNotice ? <div className="web-preview-capture-notice" role="status">{captureNotice}</div> : null}
    </>
  )

  if (embedded) {
    return <div className="web-preview-panel web-preview-panel-embedded" data-browser-owner={previewKey} data-agent-automation={String(agentDocumentation)}>{content}</div>
  }

  return (
    <ToolPanel className="web-preview-panel" label={t('panels.browser')} data-browser-owner={previewKey} data-agent-automation={String(agentDocumentation)} onEscape={() => { if (designMode) setDesignMode(false); else onClose() }} onClose={onClose}>
      {content}
    </ToolPanel>
  )
}

export function normalizePreviewUrl(value: string, allowExternal = false): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if ((/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) || /^(?:javascript|data|file|about|blob):/i.test(trimmed)) return null
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withProtocol)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
    return allowExternal || loopback ? url.toString() : null
  } catch {
    return null
  }
}
