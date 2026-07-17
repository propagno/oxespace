import { ArrowLeft, ArrowRight, Camera, ExternalLink, Minus, Monitor, MonitorPlay, Plus, RotateCw, Smartphone, Tablet, X } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react'
import type { Workspace } from '../../../shared/types/workspace'
import { useUIStore } from '../../store/ui.store'

interface WebPreviewPanelProps {
  workspace: Workspace
  onRunCommand: (command: string) => void
  onClose: () => void
  embedded?: boolean
}

const DEFAULT_URL = 'http://localhost:3000'

type Viewport = 'desktop' | 'tablet' | 'mobile'

const VIEWPORTS: Record<Viewport, { label: string; width: number | null; height: number | null }> = {
  desktop: { label: 'Desktop', width: null, height: null },
  tablet: { label: 'Tablet · 768px', width: 768, height: 1024 },
  mobile: { label: 'Mobile · 390px', width: 390, height: 844 }
}

export function WebPreviewPanel({ embedded = false, onClose, workspace }: WebPreviewPanelProps): ReactElement {
  const [draftUrl, setDraftUrl] = useState(DEFAULT_URL)
  const [url, setUrl] = useState<string | null>(null)
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [frameKey, setFrameKey] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [viewport, setViewport] = useState<Viewport>('desktop')
  const [captureNotice, setCaptureNotice] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const normalizedUrl = useMemo(() => normalizeUrl(draftUrl), [draftUrl])
  const canOpen = normalizedUrl !== null
  const canGoBack = historyIndex > 0
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1
  const frameStyle = { zoom: zoom / 100 } as CSSProperties

  const open = (): void => {
    if (!normalizedUrl) return
    const nextUrl = normalizedUrl
    setUrl(nextUrl)
    setHistory((current) => {
      const next = current.slice(0, historyIndex + 1)
      if (next[next.length - 1] !== nextUrl) next.push(nextUrl)
      setHistoryIndex(next.length - 1)
      return next
    })
    setFrameKey((value) => value + 1)
  }

  const goBack = (): void => {
    if (!canGoBack) return
    const nextIndex = historyIndex - 1
    const nextUrl = history[nextIndex]
    setHistoryIndex(nextIndex)
    setDraftUrl(nextUrl)
    setUrl(nextUrl)
    setFrameKey((value) => value + 1)
  }

  const goForward = (): void => {
    if (!canGoForward) return
    const nextIndex = historyIndex + 1
    const nextUrl = history[nextIndex]
    setHistoryIndex(nextIndex)
    setDraftUrl(nextUrl)
    setUrl(nextUrl)
    setFrameKey((value) => value + 1)
  }

  const reload = (): void => setFrameKey((value) => value + 1)

  // Watch this workspace's pending preview slot — populated by App.tsx when
  // `oxespace_open_web_preview` tool was invoked. Two layers: (a) the panel
  // may be already mounted and listening live; (b) the panel may have just
  // mounted because of the auto-open in App.tsx — in either case, this hook
  // sees the new pending URL and loads it. Entries are workspace-keyed so an
  // agent opening one preview cannot overwrite another workspace's request.
  const pendingWebPreview = useUIStore((s) => s.pendingWebPreviewByWorkspace[workspace.id] ?? null)
  const setPendingWebPreview = useUIStore((s) => s.setPendingWebPreview)
  useEffect(() => {
    if (!pendingWebPreview) return
    const nextUrl = normalizeUrl(pendingWebPreview)
    setPendingWebPreview(workspace.id, null)
    if (!nextUrl) return
    setDraftUrl(pendingWebPreview)
    setUrl(nextUrl)
    setHistory((current) => {
      const next = current.slice(0, historyIndex + 1)
      if (next[next.length - 1] !== nextUrl) next.push(nextUrl)
      setHistoryIndex(next.length - 1)
      return next
    })
    setFrameKey((value) => value + 1)
  }, [pendingWebPreview, workspace.id, historyIndex, setPendingWebPreview])
  const zoomOut = (): void => setZoom((value) => Math.max(50, value - 10))
  const zoomIn = (): void => setZoom((value) => Math.min(150, value + 10))
  const openExternal = (): void => { if (url) window.open(url, '_blank', 'noopener,noreferrer') }
  const viewportConfig = VIEWPORTS[viewport]
  const handleCapture = async (): Promise<void> => {
    if (!url || capturing) return
    setCapturing(true)
    setCaptureNotice(null)
    try {
      await window.oxe.mcpInternal.captureWebPreview()
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
        <button type="button" className="web-preview-go-button" disabled={!canOpen} onClick={open}>
          Go
        </button>
        <div className="web-preview-zoom-controls" aria-label="Zoom controls">
          <button type="button" aria-label="Zoom out" onClick={zoomOut}><Minus size={13} aria-hidden="true" /></button>
          <span>{zoom}%</span>
          <button type="button" aria-label="Zoom in" onClick={zoomIn}><Plus size={13} aria-hidden="true" /></button>
        </div>
        <button type="button" className="web-preview-nav-button" aria-label="Desktop viewport" aria-pressed={viewport === 'desktop'} onClick={() => setViewport('desktop')}><Monitor size={14} aria-hidden="true" /></button>
        <button type="button" className="web-preview-nav-button" aria-label="Tablet viewport" aria-pressed={viewport === 'tablet'} onClick={() => setViewport('tablet')}><Tablet size={14} aria-hidden="true" /></button>
        <button type="button" className="web-preview-nav-button" aria-label="Mobile viewport" aria-pressed={viewport === 'mobile'} onClick={() => setViewport('mobile')}><Smartphone size={14} aria-hidden="true" /></button>
        <button type="button" className="web-preview-nav-button" aria-label="Capture preview to clipboard" title="Copy preview to clipboard" disabled={!url || capturing} onClick={() => void handleCapture()}><Camera size={14} aria-hidden="true" /></button>
        <button type="button" className="web-preview-nav-button" aria-label="Open in browser" disabled={!url} onClick={openExternal}>
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="web-preview-stage">
        {url ? (
          <div className="web-preview-frame-wrap">
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
              <iframe
                key={`${url}-${frameKey}`}
                title="Workspace web preview"
                src={url}
                style={frameStyle}
                sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts allow-downloads"
              />
            </div>
          </div>
        ) : (
          <div className="web-preview-empty-state">
            <MonitorPlay size={56} aria-hidden="true" />
            <strong>Web Preview</strong>
            <span>Enter a URL above to preview a website</span>
            <small>Tip: create a "server" script with a preview URL to auto-open this panel</small>
          </div>
        )}
      </div>
      {captureNotice ? <div className="web-preview-capture-notice" role="status">{captureNotice}</div> : null}
    </>
  )

  if (embedded) {
    return <div className="web-preview-panel web-preview-panel-embedded">{content}</div>
  }

  return (
    <div className="web-preview-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="web-preview-panel" role="dialog" aria-modal="true" aria-label="Web Preview" onMouseDown={(event) => event.stopPropagation()}>
        {content}
      </section>
    </div>
  )
}

function normalizeUrl(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withProtocol)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}
