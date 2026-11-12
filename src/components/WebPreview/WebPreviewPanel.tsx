import { AlertCircle, ArrowLeft, ArrowRight, Camera, ExternalLink, MousePointerClick, Minus, MonitorPlay, Plus, RotateCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { ToolPanel, Button, EmptyState, ErrorState, Spinner } from '../../ui'
import { formatDesignGrabs, type DesignGrabContext } from '../../../shared/types/design-mode'
import type { DesignGrabSource } from '../../../shared/design-source'
import type { BrowserPreviewEvent, BrowserPreviewSessionState } from '../../../shared/types/browser-preview'
import type { Workspace } from '../../../shared/types/workspace'
import { pasteIntoAgentTerminal } from '../../lib/sendToAgent'
import { openExternalLink } from '../../lib/externalLinks'
import { ConfirmDialog } from '../../ui'
import { useUIStore } from '../../store/ui.store'
import { useEditorStore } from '../../store/editor.store'
import { useWorkspaceStore } from '../../store/workspace.store'
import { DesignGrabSheet, type DesignGrabItem } from './DesignGrabSheet'
import { locateDesignSource } from './designSource'
import { NativePreviewHost } from './NativePreviewHost'
import { AgentBrowserChrome } from './AgentBrowserChrome'
import { PreviewEmptyState } from './PreviewEmptyState'
import { PREVIEW_DEVICES } from '../../../shared/preview-devices'
import { DeviceMenu, fitDeviceFrame } from './DeviceMenu'
import { humanizeError } from '../../utils/humanizeError'
import { useTranslation } from 'react-i18next'
import { useKeybindings } from '../../keyboard/keybindings'
import { i18n } from '../../i18n'

const tc = i18n.getFixedT(null, 'code')

interface WebPreviewPanelProps {
  workspace: Workspace
  threadId?: string
  onRunCommand: (command: string) => void
  onClose: () => void
  embedded?: boolean
  /** The conversation's draft, in OxeChat. The captures of the picked elements go with it as attachments. */
  onSendToAgent?: (prompt: string, extra?: { images: PreviewAttachment[] }) => void | Promise<void>
  /** Shows a file of the project (where a picked element is written). Without it the Files panel of OxeCode opens. */
  onOpenFile?: (relativePath: string, line?: number) => void
}

/** A capture handed to the conversation with a Design Mode selection. */
export interface PreviewAttachment { name: string; dataUrl: string }

const NO_CONTEXT: DesignGrabContext = { source: null, candidates: [], components: [], screenshotPath: null }

const DEFAULT_URL = 'http://localhost:3000'

type Viewport = 'desktop' | 'tablet' | 'mobile'
interface PreviewTab { id: string; draftUrl: string; url: string | null; loading: boolean; error: string | null; canGoBack: boolean; canGoForward: boolean }

const VIEWPORTS: Record<Viewport, { width: number | null; height: number | null }> = {
  desktop: { width: null, height: null },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 }
}

export function WebPreviewPanel({ embedded = false, onClose, onOpenFile, onRunCommand, onSendToAgent, workspace, threadId }: WebPreviewPanelProps): ReactElement {
  const agentName = workspace.panes?.find(pane => pane.agentName)?.agentName ?? tc('agentBrowser.defaultAgent')
  const { t } = useTranslation('code')
  useEffect(() => { void window.oxe?.featureUsage?.record?.('agentBrowser') }, [])
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
  const [deviceChoice, setDeviceChoice] = useState<{ deviceId: string | null; rotated: boolean }>({ deviceId: null, rotated: false })
  const [captureNotice, setCaptureNotice] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [allowExternal, setAllowExternal] = useState(false)
  const externalPageBlocked = Boolean(url && !normalizePreviewUrl(url, allowExternal))
  const [agentAutomation, setAgentAutomation] = useState(false)
  const [consentOpen, setConsentOpen] = useState(false)
  // #3 Design Mode: pick an element in the previewed page and hand it to an agent.
  const [designMode, setDesignMode] = useState(false)
  // Escape first leaves Design Mode (the hint says so), then closes the panel.
  // Every element picked since the sheet opened: one click each, or several in a row with Shift or "Select another".
  const [grabs, setGrabs] = useState<DesignGrabItem[]>([])
  /** The picker stays on after a pick (asked from the sheet). */
  const [designKeep, setDesignKeep] = useState(false)
  const patchGrab = useCallback((id: string, patch: (item: DesignGrabItem) => DesignGrabItem): void => setGrabs(current => current.map(item => item.id === id ? patch(item) : item)), [])
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

  const reload = (): void => {
    if (pageError) { open(); return }
    void window.oxe.browserPreview.reload({ownerKey:previewKey,tabId:activeTabId}).catch(error => setCaptureNotice(humanizeError(error, tc('preview.error.reload'))))
  }
  const changeTab = (action:'new'|'select'|'close',tabId?:string): void => {
    void window.oxe.browserPreview.session({ownerKey:previewKey,action,tabId}).then(applySession).catch(error => setCaptureNotice(humanizeError(error, tc('preview.error.tabs'))))
    setDesignMode(false)
  }

  // Native guest events arrive from the owning BrowserWindow; ignore other tabs.
  useEffect(() => {
    return window.oxe.browserPreview.onEvent((event: BrowserPreviewEvent) => {
      if (event.ownerKey !== previewKey) return
      if (event.type === 'session' && event.session) { applySession(event.session); return }
      // Main took agent access away (T43): show it off; turning it on asks the person again.
      if (event.type === 'access') { if (event.agentAccess === false) setAgentAutomation(false); return }
      if (event.type === 'navigation' && event.url) updateTab(event.tabId, tab => ({...tab,draftUrl:event.url!,url:event.url!,error:null,canGoBack:event.canGoBack === true,canGoForward:event.canGoForward === true}))
      if (event.type === 'loading') updateTab(event.tabId, tab => ({...tab,loading:event.loading === true,error:event.loading ? null : tab.error}))
      if (event.type === 'failed') updateTab(event.tabId, tab => ({...tab,loading:false,error:event.message ?? tc('preview.pageFailed')}))
      if (event.tabId !== activeTabId) return
      if (event.type === 'ready') { readyTabs.current.add(event.tabId); setGuestReady(true) }
      if (event.type === 'loading' && event.loading) { readyTabs.current.delete(event.tabId); setGuestReady(false) }
      if (event.type === 'cancel') {
        setDesignMode(false)
        setDesignKeep(false)
        return
      }
      if (event.type !== 'grab' || !event.payload) return
      const payload = event.payload
      if (!payload.keepPicking) { setDesignMode(false); setDesignKeep(false) }
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      setGrabs(current => [...current.filter(item => item.payload.selector !== payload.selector || item.payload.pageUrl !== payload.pageUrl), { id, payload, screenshot: null, context: { ...NO_CONTEXT, components: payload.probe?.components ?? [] }, locating: true }].slice(-6))
      // The capture and the search for the code run side by side; the sheet shows each as it arrives.
      void window.oxe.browserPreview.captureElementFile({ownerKey:previewKey,tabId:activeTabId,rect:payload.rect})
        .then(capture => { if (capture) patchGrab(id, item => ({ ...item, screenshot: capture.dataUrl, context: { ...item.context, screenshotPath: capture.path } })) })
        .catch(() => {})
      void locateDesignSource(payload, { id: workspace.id, rootPath: workspace.rootPath })
        .then(found => patchGrab(id, item => ({ ...item, locating: false, context: { ...item.context, ...found } })))
        .catch(() => patchGrab(id, item => ({ ...item, locating: false })))
    })
  }, [previewKey, activeTabId, applySession, patchGrab, workspace.id, workspace.rootPath])

  // A new document means a fresh guest with the picker off.
  useEffect(() => {
    setGuestReady(readyTabs.current.has(activeTabId))
    setDesignMode(false)
  }, [url, activeTabId])

  // Keep the guest in sync with the toggle, including after a reload.
  useEffect(() => {
    if (!guestReady) return
    void window.oxe.browserPreview.designMode({ownerKey:previewKey,tabId:activeTabId,enabled:designMode,keep:designKeep}).catch(() => {})
  }, [designMode, designKeep, guestReady, previewKey, activeTabId])

  useEffect(() => {
    // Main answers what applies (T43): if it says off, the toggle shows off, and turning it on asks the person again.
    for (const tab of tabs) if (tab.url) void window.oxe.browserPreview.setAccess({ownerKey:previewKey,tabId:tab.id,agentAccess:agentAutomation,allowExternal})
      .then(result => { if (agentAutomation && result?.agentAccess === false) setAgentAutomation(false) }).catch(() => {})
  }, [tabs, previewKey, agentAutomation, allowExternal])

  const toggleDesignMode = useCallback((): void => {
    if (!url || !guestReady) {
      setCaptureNotice(tc('preview.designWait'))
      return
    }
    setDesignMode((value) => !value)
  }, [url, guestReady])

  const closeGrabs = useCallback((): void => { setGrabs([]); setDesignMode(false); setDesignKeep(false) }, [])
  // The shortcut works wherever the Browser is on screen; with no page loaded it says what to wait for.
  useKeybindings({ 'code.designMode': toggleDesignMode, 'thread.designMode': toggleDesignMode })

  const sendGrabToAgent = useCallback(
    async (note: string): Promise<void> => {
      if (grabs.length === 0) return
      const prompt = formatDesignGrabs(grabs.map(item => ({ payload: item.payload, context: onSendToAgent ? { ...item.context, screenshotPath: null } : item.context })), note)
      if (onSendToAgent) {
        // In a conversation the captures travel as attachments; their paths are for agents in a terminal.
        const images = grabs.flatMap((item, index) => item.screenshot ? [{ name: `element-${index + 1}.png`, dataUrl: item.screenshot }] : [])
        await onSendToAgent(prompt, { images })
        closeGrabs()
        setCaptureNotice(tc('preview.addedToDraft'))
        return
      }
      const result = await pasteIntoAgentTerminal(workspace.id, prompt)
      closeGrabs()
      setCaptureNotice(result.message)
    },
    [closeGrabs, grabs, onSendToAgent, workspace.id]
  )
  const openSource = useCallback((source: DesignGrabSource): void => {
    if (onOpenFile) { void useEditorStore.getState().openFile({ workspaceId: workspace.id, rootPath: workspace.rootPath, relativePath: source.file, line: source.line ?? undefined }); onOpenFile(source.file, source.line ?? undefined); return }
    void useEditorStore.getState().openFile({ workspaceId: workspace.id, rootPath: workspace.rootPath, relativePath: source.file, line: source.line ?? undefined })
    void useWorkspaceStore.getState().updateEditorState({ workspaceId: workspace.id, editorVisible: true })
  }, [onOpenFile, workspace.id, workspace.rootPath])

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
  const activeDevice = PREVIEW_DEVICES.find(item => item.id === (deviceChoice.deviceId ?? 'desktop')) ?? PREVIEW_DEVICES[0]
  const deviceFrame = activeDevice.id !== 'desktop' ? fitDeviceFrame(activeDevice, deviceChoice.rotated, { width: 420, height: 560 }) : null
  const viewportConfig = deviceFrame ? { width: deviceFrame.width, height: deviceFrame.height } : VIEWPORTS.desktop
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
        <DeviceMenu ownerKey={previewKey} tabId={activeTabId} deviceId={deviceChoice.deviceId} rotated={deviceChoice.rotated} onChange={setDeviceChoice} />
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
        onConfirm={() => {
          // The one grant main accepts (T43): the effect's re-sends below can keep or lower access, never raise it.
          void window.oxe.browserPreview.setAccess({ownerKey:previewKey,tabId:activeTabId,agentAccess:true,allowExternal,grant:true}).catch(() => {})
          setAgentAutomation(true); setConsentOpen(false)
        }}
        description={t('preview.access.body')} />}
      <div className="web-preview-agent-access">
        <label className="web-preview-external-toggle" title={t('preview.access.toggleTitle')}>
          <input type="checkbox" aria-label={t('preview.access.toggleLabel')} checked={agentAutomation} onChange={event => {
            if (!event.currentTarget.checked) { setAgentAutomation(false); return }
            setConsentOpen(true)
          }} />{t('preview.access.toggle')}
        </label>
        <span>{agentAutomation ? t('preview.access.on') : t('preview.access.off')}</span>
      </div>

      <AgentBrowserChrome ownerKey={previewKey} tabId={activeTabId} agentName={agentName}>
      <div className="web-preview-stage" aria-busy={loading}>
        {tabs.map(tab => tab.url && !tab.error && normalizePreviewUrl(tab.url, allowExternal) && <div className="web-preview-frame-wrap" key={tab.id} style={tab.id === activeTabId ? undefined : { display: 'none' }}>
            <div
              className={`web-preview-device viewport-${activeDevice.id === 'desktop' ? 'desktop' : activeDevice.id === 'ipad-mini' ? 'tablet' : 'mobile'}`}
              style={{
                width: viewportConfig.width ? `${viewportConfig.width}px` : '100%',
                height: viewportConfig.height ? `${viewportConfig.height}px` : '100%',
                maxHeight: '100%',
                borderRadius: deviceFrame ? `${deviceFrame.radius}px` : undefined
              }}
            >
              <div className="web-preview-device-bar">
                <span>{deviceFrame ? t('deviceEmulation.activeLabel', { name: activeDevice.name, width: deviceChoice.rotated ? activeDevice.height : activeDevice.width, height: deviceChoice.rotated ? activeDevice.width : activeDevice.height }) : t('deviceEmulation.desktop')}</span>
                <code>{url}</code>
              </div>
              <NativePreviewHost key={tab.id} mount={{ownerKey:previewKey,workspaceId:workspace.id,threadId,tabId:tab.id,url:tab.url,allowExternal,agentAccess:agentAutomation}} active={tab.id === activeTabId} zoom={zoom} />
            </div>
          </div>)}
        {(!url || externalPageBlocked || pageError) && (
          <div className="web-preview-placeholder">
            {externalPageBlocked ? <EmptyState icon={<MonitorPlay size={20} />} title={t('preview.externalRequired')}>{t('preview.externalRequiredHint')}</EmptyState>
              : pageError && url && normalizePreviewUrl(url, false) ? <PreviewEmptyState kind="down" url={(() => { try { return new URL(url).host } catch { return url } })()} devScript="npm run dev" onRunDev={() => onRunCommand('npm run dev')} />
              : pageError ? <ErrorState title={t('preview.unavailable')} message={t('preview.unavailableHint')} detail={pageError} onRetry={open} retryLabel={t('preview.retry')} />
              : <PreviewEmptyState kind="none" />}
          </div>
        )}
      </div>
      </AgentBrowserChrome>
      {designMode ? (
        <div className="web-preview-design-hint" role="status">
          {t('preview.designHint')}
        </div>
      ) : null}
      {grabs.length > 0 ? (
        <DesignGrabSheet
          items={grabs}
          picking={designMode}
          onSend={(note) => void sendGrabToAgent(note)}
          onDismiss={closeGrabs}
          onRemove={id => setGrabs(current => current.filter(item => item.id !== id))}
          onAddAnother={() => { if (designMode) { setDesignMode(false); setDesignKeep(false) } else { setDesignKeep(true); setDesignMode(true) } }}
          onChooseSource={(id, source) => patchGrab(id, item => ({ ...item, context: { ...item.context, source, candidates: [item.context.source, ...item.context.candidates].filter((other): other is DesignGrabSource => Boolean(other) && other !== source) } }))}
          onOpenSource={openSource}
        />
      ) : null}
      {captureNotice ? <div className="web-preview-capture-notice" role="status">{captureNotice}</div> : null}
    </>
  )

  if (embedded) {
    return <div className="web-preview-panel web-preview-panel-embedded" data-browser-owner={previewKey} data-agent-automation={String(agentAutomation)}>{content}</div>
  }

  return (
    <ToolPanel className="web-preview-panel" label={t('panels.browser')} data-browser-owner={previewKey} data-agent-automation={String(agentAutomation)} onEscape={() => { if (designMode) setDesignMode(false); else onClose() }} onClose={onClose}>
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
