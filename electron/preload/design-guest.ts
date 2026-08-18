import { ipcRenderer } from 'electron'
import { DESIGN_MODE_CHANNELS, type DesignGrabPayload, type DesignGrabStyle } from '../../shared/types/design-mode'

/**
 * Design Mode guest script (#3). Runs inside the previewed page's <webview>,
 * isolated from the OXESpace renderer. It only ever reads from the page and
 * posts the selection back to the host — it never mutates the page beyond a
 * temporary highlight overlay it owns.
 */

const HIGHLIGHT_ID = '__oxe_design_highlight__'
const LABEL_ID = '__oxe_design_label__'
const MAX_TEXT = 400
const MAX_HTML = 1200

const REPORTED_STYLES = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'border',
  'border-radius',
  'box-shadow',
  'flex-direction',
  'gap',
  'grid-template-columns',
  'z-index'
]

let enabled = false
let highlight: HTMLDivElement | null = null
let label: HTMLDivElement | null = null

function ensureOverlay(): { box: HTMLDivElement; tag: HTMLDivElement } {
  if (!highlight) {
    highlight = document.createElement('div')
    highlight.id = HIGHLIGHT_ID
    highlight.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:2147483647',
      'border:2px solid #22d3a5',
      'background:rgba(34,211,165,0.12)',
      'border-radius:2px',
      'transition:all 40ms linear'
    ].join(';')
    document.documentElement.appendChild(highlight)
  }
  if (!label) {
    label = document.createElement('div')
    label.id = LABEL_ID
    label.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:2147483647',
      'padding:2px 6px',
      'border-radius:3px',
      'background:#22d3a5',
      'color:#06231c',
      'font:11px/1.4 ui-monospace,monospace',
      'white-space:nowrap'
    ].join(';')
    document.documentElement.appendChild(label)
  }
  return { box: highlight, tag: label }
}

function removeOverlay(): void {
  highlight?.remove()
  label?.remove()
  highlight = null
  label = null
}

/** Shortest selector that still identifies the element, best effort. */
function buildSelector(element: Element): string {
  if (element.id) return `#${CSS.escape(element.id)}`

  const parts: string[] = []
  let current: Element | null = element
  let depth = 0

  while (current && current.nodeType === Node.ELEMENT_NODE && depth < 5) {
    let part = current.tagName.toLowerCase()
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`)
      break
    }
    const classes = Array.from(current.classList)
      .filter((name) => !name.startsWith('__oxe'))
      .slice(0, 2)
    if (classes.length > 0) part += classes.map((name) => `.${CSS.escape(name)}`).join('')

    const parent: Element | null = current.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === current!.tagName)
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
    }
    parts.unshift(part)
    current = parent
    depth += 1
  }

  return parts.join(' > ')
}

function collectStyles(element: Element): DesignGrabStyle[] {
  const computed = getComputedStyle(element)
  const styles: DesignGrabStyle[] = []
  for (const property of REPORTED_STYLES) {
    const value = computed.getPropertyValue(property).trim()
    // Skip the browser defaults that carry no design intent.
    if (!value || value === 'none' || value === 'normal' || value === 'auto' || value === '0px') continue
    styles.push({ property, value })
  }
  return styles
}

function buildPayload(element: Element): DesignGrabPayload {
  const rect = element.getBoundingClientRect()
  const html = element.outerHTML ?? ''
  return {
    selector: buildSelector(element),
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    classNames: Array.from(element.classList).filter((name) => !name.startsWith('__oxe')),
    text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT),
    html: html.length > MAX_HTML ? `${html.slice(0, MAX_HTML)}…` : html,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    styles: collectStyles(element),
    pageUrl: location.href,
    pageTitle: document.title,
    devicePixelRatio: window.devicePixelRatio || 1
  }
}

function isOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && (target.id === HIGHLIGHT_ID || target.id === LABEL_ID)
}

function onPointerMove(event: MouseEvent): void {
  if (!enabled || isOverlay(event.target)) return
  const element = event.target as Element | null
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return

  const rect = element.getBoundingClientRect()
  const { box, tag } = ensureOverlay()
  box.style.left = `${rect.x}px`
  box.style.top = `${rect.y}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
  tag.textContent = `${element.tagName.toLowerCase()} · ${Math.round(rect.width)}×${Math.round(rect.height)}`
  tag.style.left = `${rect.x}px`
  tag.style.top = `${Math.max(0, rect.y - 20)}px`
}

function onClick(event: MouseEvent): void {
  if (!enabled) return
  event.preventDefault()
  event.stopPropagation()
  const element = event.target as Element | null
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return
  ipcRenderer.sendToHost(DESIGN_MODE_CHANNELS.grab, buildPayload(element))
  setEnabled(false)
}

function onKeyDown(event: KeyboardEvent): void {
  if (!enabled || event.key !== 'Escape') return
  event.preventDefault()
  setEnabled(false)
  ipcRenderer.sendToHost(DESIGN_MODE_CHANNELS.cancel)
}

function setEnabled(next: boolean): void {
  if (enabled === next) return
  enabled = next
  if (next) {
    document.addEventListener('mousemove', onPointerMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
    ensureOverlay()
  } else {
    document.removeEventListener('mousemove', onPointerMove, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    removeOverlay()
  }
}

ipcRenderer.on(DESIGN_MODE_CHANNELS.setEnabled, (_event, value: boolean) => {
  setEnabled(value === true)
})
