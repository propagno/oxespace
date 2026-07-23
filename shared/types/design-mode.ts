/** Design Mode (#3) — grab an element from the previewed page for an agent. */

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
}

/** Channel names exchanged between the guest preload and the renderer host. */
export const DESIGN_MODE_CHANNELS = {
  /** host → guest: enable/disable the picker. */
  setEnabled: 'oxe:design-set-enabled',
  /** guest → host: the user picked an element. */
  grab: 'oxe:design-grab',
  /** guest → host: the picker was cancelled with Escape. */
  cancel: 'oxe:design-cancel'
} as const

/** Deterministic prompt block handed to the agent. */
export function formatDesignGrab(payload: DesignGrabPayload, note: string): string {
  const lines: string[] = []
  lines.push('The user selected an element in the web preview.')
  lines.push('')
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
