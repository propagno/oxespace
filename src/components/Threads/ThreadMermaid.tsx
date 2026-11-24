import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import DOMPurify from 'dompurify'
import { Check, Code2, Copy, Download, Maximize2, Workflow, ZoomIn, ZoomOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { currentMode, onModeChange, type ColorMode } from '../../design/mode'
import { Button, Dialog, IconButton } from '../../ui'
import { toast } from '../../ui/Toast'

type Mermaid = typeof import('mermaid').default
let mermaid: Mermaid | null = null
let loadingMermaid: Promise<Mermaid> | null = null
let configuredFor: ColorMode | null = null
let sequence = 0
/** One drawing at a time: the library keeps one configuration and measures in the page. */
let queue: Promise<unknown> = Promise.resolve()

/** Above this the text is shown as code: a diagram that large is not one a person reads. */
export const MAX_DIAGRAM_CHARS = 20_000
const SETTLE_MS = 250
/**
 * The last drawings, by mode and text: a block that is built again (the list of messages is windowed, a conversation
 * is reopened) shows its drawing at once instead of its code and then its drawing.
 */
const drawings = new Map<string, string>()
const MAX_DRAWINGS = 40
const drawingKey = (code: string, mode: ColorMode): string => `${mode}\u0000${code}`
function remember(code: string, mode: ColorMode, svg: string): void {
  drawings.delete(drawingKey(code, mode))
  drawings.set(drawingKey(code, mode), svg)
  for (const oldest of drawings.keys()) { if (drawings.size <= MAX_DRAWINGS) break; drawings.delete(oldest) }
}

/**
 * The diagram as an SVG, or null when the text is not (yet) a diagram Mermaid can read. The text comes from an agent:
 * the strict level turns off clicks and HTML in labels, labels are drawn as SVG text, and what Mermaid wrote is
 * sanitized again before it reaches the page.
 */
export function drawDiagram(code: string, mode: ColorMode): Promise<string | null> {
  const run = queue.then(async () => {
    loadingMermaid ??= import('mermaid').then(module => module.default)
    const lib = mermaid ??= await loadingMermaid
    if (configuredFor !== mode) {
      lib.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, suppressErrorRendering: true, theme: mode === 'dark' ? 'dark' : 'neutral', fontFamily: 'inherit' })
      configuredFor = mode
    }
    if (!await lib.parse(code, { suppressErrors: true })) return null
    const { svg } = await lib.render(`oxe-diagram-${++sequence}`, code)
    return DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } })
  }).catch(() => { loadingMermaid = mermaid ? loadingMermaid : null; return null })
  queue = run
  return run
}

function useColorMode(): ColorMode {
  const [mode, setMode] = useState<ColorMode>(currentMode)
  useEffect(() => onModeChange(setMode), [])
  return mode
}

/**
 * A fenced block named `mermaid`, drawn. While the answer is still arriving the text is not a whole diagram yet: the
 * code shows under "Building the diagram…", and the drawing takes its place once the text reads as one. A finished
 * text that never parses keeps the code, with one note above it, whatever was drawn while it streamed. Once drawn, the bar reads Diagram | Code,
 * Enlarge (the same sanitized drawing, larger, in a dialog) and Copy, which copies the code, never the picture.
 */
export function MermaidDiagram({ code, streaming = false }: { code: string; streaming?: boolean }): ReactElement {
  const { t } = useTranslation('thread')
  const mode = useColorMode()
  const [drawn, setDrawn] = useState<{ code: string; mode: ColorMode; svg: string } | null>(() => { const svg = drawings.get(drawingKey(code, mode)); return svg ? { code, mode, svg } : null })
  // The text that could not be drawn, not a flag: the verdict on one text never counts for the next.
  const [unreadable, setUnreadable] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [copied, setCopied] = useState(false)
  const [enlarged, setEnlarged] = useState(false)
  const enlargeButton = useRef<HTMLButtonElement>(null)
  // The switch shows one word each (Diagram | Code); its accessible names say what a press does and hold that word.
  const labelId = useId()
  useEffect(() => {
    if (code.length > MAX_DIAGRAM_CHARS || !code.trim()) { setUnreadable(code); return }
    const known = drawings.get(drawingKey(code, mode))
    if (known) { setUnreadable(null); setDrawn(current => current?.code === code && current.mode === mode ? current : { code, mode, svg: known }); return }
    setUnreadable(null)
    let live = true
    // The text changes many times a second while it streams: draw once it has been still for a moment.
    const timer = setTimeout(() => {
      void drawDiagram(code, mode).then(svg => {
        if (!live) return
        if (!svg) { setUnreadable(code); return }
        setUnreadable(null)
        remember(code, mode, svg)
        setDrawn({ code, mode, svg })
      })
    }, SETTLE_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [code, mode])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  // A drawing of an earlier text stays while the newer text may still become readable; once a finished text failed,
  // only its own drawing may show. A drawing of another mode, never.
  const failed = !streaming && unreadable === code
  const svg = drawn && drawn.mode === mode && (!failed || drawn.code === code) ? drawn.svg : null
  const diagram = svg !== null && !showCode
  const building = streaming && svg === null
  const cannot = failed && svg === null
  return <div className="thread-code-block thread-diagram-block" data-testid="thread-diagram">
    {cannot && <p className="thread-diagram-note" role="note">{t('markdown.diagramFailed')}</p>}
    <div className="thread-code-toolbar">
      {svg !== null
        ? <span className="thread-diagram-switch">
          <span id={`${labelId}-diagram`} hidden>{t('markdown.showDiagram')}</span>
          <span id={`${labelId}-code`} hidden>{t('markdown.showCode')}</span>
          <Button variant="ghost" size="sm" aria-pressed={!showCode} aria-labelledby={`${labelId}-diagram`} onClick={() => setShowCode(false)} icon={<Workflow size={12} aria-hidden="true" />}>{t('markdown.diagram')}</Button>
          <Button variant="ghost" size="sm" aria-pressed={showCode} aria-labelledby={`${labelId}-code`} onClick={() => setShowCode(true)} icon={<Code2 size={12} aria-hidden="true" />}>{t('markdown.code')}</Button>
        </span>
        : <span data-testid="thread-code-language"><Workflow size={12} aria-hidden="true" /> {t('markdown.diagram')}</span>}
      {svg !== null && <Button variant="ghost" size="sm" ref={enlargeButton} onClick={() => setEnlarged(true)} icon={<Maximize2 size={12} aria-hidden="true" />}>{t('markdown.enlarge')}</Button>}
      <Button variant="ghost" size="sm" aria-label={t('markdown.copyCode')} onClick={() => { void navigator.clipboard.writeText(code).then(() => setCopied(true), () => undefined) }}
        icon={copied ? <Check size={12} className="oxe-confirm" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}>{copied ? t('markdown.copied') : t('markdown.copy')}</Button>
    </div>
    {building && <p className="thread-diagram-building">{t('markdown.diagramBuilding')}</p>}
    {diagram
      ? <div className="thread-diagram" role="img" aria-label={t('markdown.diagram')} dangerouslySetInnerHTML={{ __html: svg }} />
      : <pre><code>{code}</code></pre>}
    {enlarged && svg !== null && <Dialog title={t('markdown.diagram')} size="xl" onClose={() => setEnlarged(false)} returnFocusTo={() => enlargeButton.current}>
      <MermaidEnlarged svg={svg} />
    </Dialog>}
  </div>
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** The drawing's size in CSS pixels, from its width/height or its viewBox. */
function svgSize(svg: string): { width: number; height: number } {
  const element = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  const box = (element.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  // Mermaid writes width="100%" and the real size in the viewBox; a size in percent says nothing here.
  const read = (name: string): number => { const raw = element.getAttribute(name) ?? ''; const value = parseFloat(raw); return raw.trim().endsWith('%') || !Number.isFinite(value) ? 0 : value }
  return { width: box[2] > 0 ? box[2] : read('width') || 800, height: box[3] > 0 ? box[3] : read('height') || 600 }
}

/**
 * The Enlarge dialog's viewer (OXE-379): zoom (buttons, Ctrl+wheel, + − 0), pan by dragging, and the drawing as SVG or
 * PNG. It shows the same sanitized drawing; the PNG is drawn from it at twice its size.
 */
export function MermaidEnlarged({ svg }: { svg: string }): ReactElement {
  const { t } = useTranslation('thread')
  const [step, setStep] = useState(ZOOM_STEPS.indexOf(1))
  const view = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const zoom = ZOOM_STEPS[step]
  const natural = useMemo(() => svgSize(svg), [svg])
  // Mermaid caps its drawing with an inline max-width at its own size; here the canvas sets the size, zoomed.
  useLayoutEffect(() => { view.current?.querySelector('svg')?.style.removeProperty('max-width') }, [svg])
  const zoomBy = (delta: number): void => setStep(current => Math.max(0, Math.min(ZOOM_STEPS.length - 1, current + delta)))
  const exportPng = (): void => {
    const { width, height } = natural
    const image = new Image()
    const failed = (): void => { toast({ intent: 'danger', title: t('markdown.exportFailed') }) }
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(width * 2)
      canvas.height = Math.round(height * 2)
      const context = canvas.getContext('2d')
      if (!context) { failed(); return }
      context.scale(2, 2)
      context.drawImage(image, 0, 0, width, height)
      canvas.toBlob(blob => { if (blob) download('diagram.png', blob); else failed() }, 'image/png')
    }
    image.onerror = failed
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  }
  return <div className="thread-diagram-viewer">
    <div className="thread-diagram-viewer-toolbar" role="toolbar" aria-label={t('markdown.diagramTools')}>
      <IconButton size="sm" variant="ghost" label={t('markdown.zoomOut')} icon={<ZoomOut size={14} aria-hidden="true" />} disabled={step === 0} onClick={() => zoomBy(-1)} />
      <Button size="sm" variant="ghost" aria-label={t('markdown.zoomReset', { percent: Math.round(zoom * 100) })} onClick={() => setStep(ZOOM_STEPS.indexOf(1))}>{`${Math.round(zoom * 100)}%`}</Button>
      <IconButton size="sm" variant="ghost" label={t('markdown.zoomIn')} icon={<ZoomIn size={14} aria-hidden="true" />} disabled={step === ZOOM_STEPS.length - 1} onClick={() => zoomBy(1)} />
      <span className="thread-diagram-viewer-spacer" />
      <Button size="sm" variant="ghost" icon={<Download size={12} aria-hidden="true" />} onClick={() => download('diagram.svg', new Blob([svg], { type: 'image/svg+xml' }))}>{t('markdown.downloadSvg')}</Button>
      <Button size="sm" variant="ghost" icon={<Download size={12} aria-hidden="true" />} onClick={exportPng}>{t('markdown.downloadPng')}</Button>
    </div>
    <div ref={view} className="thread-diagram thread-diagram-enlarged" role="img" aria-label={t('markdown.diagram')} tabIndex={0} data-zoom={zoom}
      onWheel={event => { if (!event.ctrlKey) return; event.preventDefault(); zoomBy(event.deltaY < 0 ? 1 : -1) }}
      onKeyDown={event => { if (event.key === '+' || event.key === '=') zoomBy(1); else if (event.key === '-') zoomBy(-1); else if (event.key === '0') setStep(ZOOM_STEPS.indexOf(1)) }}
      onPointerDown={event => { const node = view.current; if (!node || event.button !== 0) return; drag.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop }; node.setPointerCapture?.(event.pointerId) }}
      onPointerMove={event => { const node = view.current, start = drag.current; if (!node || !start) return; node.scrollLeft = start.left - (event.clientX - start.x); node.scrollTop = start.top - (event.clientY - start.y) }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <div className="thread-diagram-canvas" style={{ width: `${Math.round(natural.width * zoom)}px` }} dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  </div>
}
