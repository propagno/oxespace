import { AlertCircle, ArrowLeft, ArrowRight, Camera, ExternalLink, LoaderCircle, MousePointerClick, Minus, Monitor, MonitorPlay, Plus, RotateCw, Smartphone, Tablet, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { DesignGrabPayload } from '../../../shared/types/design-mode'
import type { BrowserPreviewEvent, BrowserPreviewSessionState } from '../../../shared/types/browser-preview'
import type { Workspace } from '../../../shared/types/workspace'
import { pasteIntoAgentTerminal } from '../../lib/sendToAgent'
import { useUIStore } from '../../store/ui.store'
import { DesignGrabSheet } from './DesignGrabSheet'
import { NativePreviewHost } from './NativePreviewHost'

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

const VIEWPORTS: Record<Viewport, { label: string; width: number | null; height: number | null }> = {
  desktop: { label: 'Desktop', width: null, height: null },
  tablet: { label: 'Tablet · 768px', width: 768, height: 1024 },
  mobile: { label: 'Mobile · 390px', width: 390, height: 844 }
}

export function WebPreviewPanel({ embedded = false, onClose, onSendToAgent, workspace, threadId }: WebPreviewPanelProps): ReactElement {
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
    void window.oxe.browserPreview.session({ownerKey:previewKey,action:'open'}).then(session => { if (!cancelled) applySession(session) }).catch(error => { if (!cancelled) setCaptureNotice(error instanceof Error ? error.message : 'Could not open browser tabs.') })
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
  // #3 Design Mode: pick an element in the previewed page and hand it to an agent.
  const [designMode, setDesignMode] = useState(false)
  const [grab, setGrab] = useState<{ payload: DesignGrabPayload; screenshot: string | null } | null>(null)
  // `send()` and `capturePage()` throw until the guest emits dom-ready.
  const [guestReady, setGuestReady] = useState(false)
  const readyTabs = useRef(new Set<string>())
  const normalizedUrl = useMemo(() => normalizePreviewUrl(draftUrl, allowExternal), [draftUrl, allowExternal])
  const canOpen = normalizedUrl !== null
  const open = (): void => {
    if (!activeTabId) return
    if (!normalizedUrl) {
      setCaptureNotice(allowExternal ? 'Enter a valid HTTP or HTTPS URL.' : 'Local-only mode accepts localhost, 127.0.0.1 and ::1.')
      return
    }
    const nextUrl = normalizedUrl
    void window.oxe.browserPreview.session({ownerKey:previewKey,action:'navigate',tabId:activeTabId,url:nextUrl,allowExternal}).then(applySession).catch(error => setCaptureNotice(error instanceof Error ? error.message : 'Could not open the page.'))
  }

  const goBack = (): void => {
    if (!canGoBack) return
    void window.oxe.browserPreview.back({ownerKey:previewKey,tabId:activeTabId}).catch(error => setCaptureNotice(error instanceof Error ? error.message : 'Could not go back.'))
  }

  const goForward = (): void => {
    if (!canGoForward) return
    void window.oxe.browserPreview.forward({ownerKey:previewKey,tabId:activeTabId}).catch(error => setCaptureNotice(error instanceof Error ? error.message : 'Could not go forward.'))
  }

  const reload = (): void => { void window.oxe.browserPreview.reload({ownerKey:previewKey,tabId:activeTabId}).catch(error => setCaptureNotice(error instanceof Error ? error.message : 'Could not reload.')) }
  const changeTab = (action:'new'|'select'|'close',tabId?:string): void => {
    void window.oxe.browserPreview.session({ownerKey:previewKey,action,tabId}).then(applySession).catch(error => setCaptureNotice(error instanceof Error ? error.message : 'Could not update browser tabs.'))
    setDesignMode(false)
  }

  // Native guest events arrive from the owning BrowserWindow; ignore other tabs.
  useEffect(() => {
    return window.oxe.browserPreview.onEvent((event: BrowserPreviewEvent) => {
      if (event.ownerKey !== previewKey) return
      if (event.type === 'session' && event.session) { applySession(event.session); return }
      if (event.type === 'navigation' && event.url) updateTab(event.tabId, tab => ({...tab,draftUrl:event.url!,url:event.url!,error:null,canGoBack:event.canGoBack === true,canGoForward:event.canGoForward === true}))
      if (event.type === 'loading') updateTab(event.tabId, tab => ({...tab,loading:event.loading === true,error:event.loading ? null : tab.error}))
      if (event.type === 'failed') updateTab(event.tabId, tab => ({...tab,loading:false,error:event.message ?? 'The page could not be loaded.'}))
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
      setCaptureNotice('Wait for the preview to finish loading before using Design Mode.')
      return
    }
    setDesignMode((value) => !value)
  }, [url, guestReady])

  const sendGrabToAgent = useCallback(
    async (prompt: string): Promise<void> => {
      if (onSendToAgent) {
        await onSendToAgent(prompt)
        setGrab(null)
        setCaptureNotice('Added to the active Thread draft.')
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
      setCaptureNotice('An agent requested an external URL. Enable External preview to open it.')
      return
    }
    setCaptureNotice(null)
    updateTab(activeTabId, tab => ({ ...tab, draftUrl: pendingWebPreview }))
    void window.oxe.browserPreview.session({ownerKey:previewKey,action:'navigate',tabId:activeTabId,url:nextUrl,allowExternal}).then(session => { applySession(session); setPendingWebPreview(previewKey, null) }).catch(error => setCaptureNotice(error instanceof Error ? error.message : 'Could not open the page.'))
  }, [pendingWebPreview, previewKey, activeTabId, setPendingWebPreview, allowExternal, applySession])
  const zoomOut = (): void => setZoom((value) => Math.max(50, value - 10))
  const zoomIn = (): void => setZoom((value) => Math.min(150, value + 10))
  const openExternal = (): void => { if (url) window.open(url, '_blank', 'noopener,noreferrer') }
  const viewportConfig = VIEWPORTS[viewport]
  const handleCapture = async (): Promise<void> => {
    if (!url || capturing) return
    setCapturing(true)
    setCaptureNotice(null)
    try {
      await window.oxe.browserPreview.captureClipboard({ownerKey:previewKey,tabId:activeTabId})
      setCaptureNotice('Preview copied to the clipboard.')
    } catch (error) {
      setCaptureNotice(error instanceof Error ? error.message : 'Could not capture the preview.')
    } finally {
      setCapturing(false)
    }
  }

  const content = (
    <>
      <header className="web-preview-header">
        <div className="web-preview-title">
          <MonitorPlay size={14} aria-hidden="true" />
          <strong>Web Preview</strong>
          <span>{workspace.name}</span>
        </div>
        <div className="web-preview-actions">
          {!embedded ? (
            <button type="button" className="icon-button" aria-label="Close web preview" onClick={onClose}>
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="web-preview-tabs" role="tablist" aria-label="Browser tabs">
        {tabs.map((tab, index) => <div className="web-preview-tab" key={tab.id} data-browser-tab-id={tab.id} data-active={tab.id === activeTabId} data-loading={tab.loading} data-error={Boolean(tab.error)}>
          {tab.loading ? <LoaderCircle size={12} className="web-preview-tab-spinner" aria-label="Loading" /> : tab.error ? <AlertCircle size={12} aria-label="Page failed" /> : null}
          <button type="button" role="tab" aria-selected={tab.id === activeTabId} aria-label={`Tab ${index + 1}: ${tab.url ? new URL(tab.url).hostname : 'New tab'}`} onClick={() => changeTab('select',tab.id)}>{tab.url ? new URL(tab.url).hostname : 'New tab'}</button>
          <button type="button" aria-label={`Close tab ${index + 1}`} onClick={() => changeTab('close',tab.id)}><X size={12} aria-hidden="true" /></button>
        </div>)}
        <button type="button" className="web-preview-new-tab" aria-label="New browser tab" onClick={() => changeTab('new')}><Plus size={14} aria-hidden="true" /></button>
      </div>

      <div className="web-preview-browserbar" aria-label="Web preview browser toolbar">
        <button type="button" className="web-preview-nav-button" aria-label="Back" disabled={!canGoBack} onClick={goBack}>
          <ArrowLeft size={14} aria-hidden="true" />
        </button>
        <button type="button" className="web-preview-nav-button" aria-label="Forward" disabled={!canGoForward} onClick={goForward}>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        <button type="button" className="web-preview-nav-button" aria-label="Reload" disabled={!url} onClick={reload}>
          <RotateCw size={14} aria-hidden="true" />
        </button>
        <input
          className="web-preview-address-input"
          value={draftUrl}
          onChange={(event) => setDraftUrl(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') open() }}
          placeholder="http://localhost:3000"
          spellCheck={false}
        />
        <button type="button" className="web-preview-go-button" disabled={!canOpen || !activeTabId} onClick={open}>
          Go
        </button>
        <label className="web-preview-external-toggle" title="Remote sites keep their own frame security headers">
          <input type="checkbox" checked={allowExternal} onChange={(event) => setAllowExternal(event.currentTarget.checked)} />
          External
        </label>
        <div className="web-preview-zoom-controls" aria-label="Zoom controls">
          <button type="button" aria-label="Zoom out" onClick={zoomOut}><Minus size={13} aria-hidden="true" /></button>
          <span>{zoom}%</span>
          <button type="button" aria-label="Zoom in" onClick={zoomIn}><Plus size={13} aria-hidden="true" /></button>
        </div>
        <button type="button" className="web-preview-nav-button" aria-label="Desktop viewport" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}><Monitor size={14} aria-hidden="true" /></button>
        <button type="button" className="web-preview-nav-button" aria-label="Tablet viewport" aria-pressed={viewport === 'tablet'} onClick={() => setViewport('tablet')}><Tablet size={14} aria-hidden="true" /></button>
        <button type="button" className="web-preview-nav-button" aria-label="Mobile viewport" aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}><Smartphone size={14} aria-hidden="true" /></button>
        <button
          type="button"
          className={`web-preview-nav-button${designMode ? ' active' : ''}`}
          aria-label="Design Mode"
          aria-pressed={designMode}
          title="Design Mode — click an element to send it to an agent"
          data-testid="design-mode-toggle"
          disabled={!url || !guestReady}
          onClick={toggleDesignMode}
        >
          <MousePointerClick size={14} aria-hidden="true" />
        </button>
        <button type="button" className="web-preview-nav-button" aria-label="Capture preview to clipboard" title="Copy preview to clipboard" disabled={!url || capturing} onClick={() => void handleCapture()}><Camera size={14} aria-hidden="true" /></button>
        <button type="button" className="web-preview-nav-button" aria-label="Open in browser" disabled={!url} onClick={openExternal}>
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="web-preview-agent-access">
        <label className="web-preview-external-toggle" title="Allow agents in this workspace to inspect and capture this preview. Captures can be sent to the agent vendor. Inputs are masked, but other private data needs explicit redaction. Click/fill/navigation require confirmation. Resets when the preview closes.">
          <input type="checkbox" aria-label="Agent documentation access" checked={agentDocumentation} onChange={event => {
            if (!event.currentTarget.checked) { setAgentDocumentation(false); return }
            setAgentDocumentation(window.confirm('Allow agents to inspect and capture this preview? Page content and screenshots may be sent to the agent vendor. Review captures for private data; inputs are masked automatically. Each click, fill or navigation asks for separate approval.'))
          }} />Agent access
        </label>
        <span>{agentDocumentation ? 'Actions ask for approval' : 'Documentation access is off'}</span>
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
                <span>{viewportConfig.label}</span>
                <code>{url}</code>
              </div>
              <NativePreviewHost key={tab.id} mount={{ownerKey:previewKey,workspaceId:workspace.id,threadId,tabId:tab.id,url:tab.url,allowExternal,agentAccess:agentDocumentation}} active={tab.id === activeTabId} zoom={zoom} />
            </div>
          </div>)}
        {(!url || externalPageBlocked || pageError) && (
          <div className="web-preview-empty-state">
            {pageError && !externalPageBlocked ? <AlertCircle size={42} aria-hidden="true" /> : <MonitorPlay size={56} aria-hidden="true" />}
            <strong>{externalPageBlocked ? 'External access required' : pageError ? 'Page unavailable' : 'Web Preview'}</strong>
            <span>{externalPageBlocked ? 'Enable External to reopen this website.' : pageError ? 'The preview could not load this page.' : 'Enter a URL above to preview a website'}</span>
            {externalPageBlocked ? null : pageError ? <><small>{pageError}</small><button type="button" className="web-preview-retry" onClick={open}>Retry</button></> : <small>Tip: create a "server" script with a preview URL to auto-open this panel</small>}
          </div>
        )}
      </div>
      {designMode ? (
        <div className="web-preview-design-hint" role="status">
          Design Mode — click an element in the preview, or press Escape to cancel.
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
    <div className="web-preview-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="web-preview-panel" role="dialog" aria-modal="true" aria-label="Web Preview" data-browser-owner={previewKey} data-agent-automation={String(agentDocumentation)} onMouseDown={(event) => event.stopPropagation()}>
        {content}
      </section>
    </div>
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
