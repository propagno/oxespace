/** Design Mode (#3) — grab an element from the previewed page for an agent. */

import { formatSourceLocation, type DesignGrabSource, type DesignSourceProbe } from '../design-source'

export interface DesignGrabRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DesignGrabStyle {
  property: string
  value: string
}

export interface DesignGrabPayload {
  /** Best-effort CSS selector that re-selects the element in the page. */
  selector: string
  tagName: string
  id: string | null
  classNames: string[]
  /** Trimmed visible text, capped. */
  text: string
  /** Opening tag plus a short slice of markup, capped. */
  html: string
  rect: DesignGrabRect
  styles: DesignGrabStyle[]
  pageUrl: string
  pageTitle: string
  /** Device pixel ratio of the guest, needed to map rect → screenshot pixels. */
  devicePixelRatio: number
  /** Where in the viewport the person clicked: main asks the page what is written there. */
  point?: { x: number; y: number }
  /** What the page told about where the element is written; added by main, never trusted as is. */
  probe?: DesignSourceProbe | null
  /** Shift was held: the picker stays on for the next element. */
  keepPicking?: boolean
}

/** What the window adds to a grab before it is shown: the file in the project, and the saved capture. */
export interface DesignGrabContext {
  /** The file of the project where the element is written, checked to exist. Null when nothing told and nothing was found. */
  source: DesignGrabSource | null
  /** Other files it may be in (a search found several); the person picks. */
  candidates: DesignGrabSource[]
  /** Components around the element, nearest first. */
  components: string[]
  /** The capture of the element saved to a file an agent can open, when it could be saved. */
  screenshotPath: string | null
}

/** Channel names exchanged between the guest preload and the renderer host. */
export const DESIGN_MODE_CHANNELS = {
  /** host → guest: enable/disable the picker. A second argument `true` keeps it on after each pick. */
  setEnabled: 'oxe:design-set-enabled',
  /** guest → host: the user picked an element. */
  grab: 'oxe:design-grab',
  /** guest → host: the picker was cancelled with Escape. */
  cancel: 'oxe:design-cancel'
} as const

/**
 * B12, E2E only: with this in the guest's `additionalArguments`, the design-guest preload exposes `window.__oxeGuestProbe`
 * (a raw `ipcRenderer.invoke` / `send`) so e2e/ipc-sender-guard.spec.ts can call channels from a real guest. The main
 * process passes it only off a packaged build with OXESPACE_E2E_GUEST_PROBE=1 (`guestProbeWebPreferences`).
 */
export const GUEST_PROBE_ARGUMENT = '--oxe-e2e-guest-probe'

/** Several picked elements as one prompt: each with its source and markup, the person's request once, at the end. */
export function formatDesignGrabs(items: Array<{ payload: DesignGrabPayload; context?: Partial<DesignGrabContext> }>, note: string): string {
  if (items.length === 1) return formatDesignGrab(items[0].payload, note, items[0].context)
  const blocks = items.map((item, index) => formatDesignGrab(item.payload, '', item.context).replace('The user selected an element in the web preview.', `Element ${index + 1} of ${items.length}:`))
  const lines = [`The user selected ${items.length} elements in the web preview.`, '', blocks.join('\n\n')]
  const trimmedNote = note.trim()
  if (trimmedNote) lines.push('', 'User request:', trimmedNote)
  return lines.join('\n')
}

/** Deterministic prompt block handed to the agent. */
export function formatDesignGrab(payload: DesignGrabPayload, note: string, context?: Partial<DesignGrabContext>): string {
  const lines: string[] = []
  lines.push('The user selected an element in the web preview.')
  lines.push('')
  const source = context?.source ?? null
  if (source) {
    const where = source.origin === 'search' ? 'Likely source (found by searching the project; confirm before editing)' : source.approximate ? 'Source (line is approximate)' : 'Source'
    lines.push(`${where}: ${formatSourceLocation(source)}${source.component ? ` — component ${source.component}` : ''}`)
  }
  const others = (context?.candidates ?? []).filter(item => !source || item.file !== source.file || item.line !== source.line)
  if (others.length > 0) lines.push(`Other places it may be: ${others.map(formatSourceLocation).join(', ')}`)
  const components = context?.components ?? []
  if (components.length > 1) lines.push(`Component tree: ${components.join(' < ')}`)
  if (context?.screenshotPath) lines.push(`Screenshot of the element: ${context.screenshotPath}`)
  if (source || others.length > 0 || components.length > 1 || context?.screenshotPath) lines.push('')
  lines.push(`Page: ${payload.pageTitle || '(untitled)'} — ${payload.pageUrl}`)
  lines.push(`Selector: ${payload.selector}`)
  lines.push(
    `Box: ${Math.round(payload.rect.width)}×${Math.round(payload.rect.height)} at (${Math.round(payload.rect.x)}, ${Math.round(payload.rect.y)})`
  )
  if (payload.text) {
    lines.push(`Text: ${payload.text}`)
  }
  lines.push('')
  lines.push('Markup:')
  lines.push(payload.html)
  if (payload.styles.length > 0) {
    lines.push('')
    lines.push('Computed styles:')
    for (const style of payload.styles) lines.push(`  ${style.property}: ${style.value}`)
  }
  const trimmedNote = note.trim()
  if (trimmedNote) {
    lines.push('')
    lines.push('User request:')
    lines.push(trimmedNote)
  }
  return lines.join('\n')
}
