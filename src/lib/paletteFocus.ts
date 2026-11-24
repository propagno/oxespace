/**
 * OXE-397: the command palette mounts only while it is open (OXE-348). Between the shortcut and its input taking focus
 * there are a render and an effect, and keys typed in that gap went to what still had focus: in a terminal, they were
 * typed into the shell ("Workspace settings" ran as a command). Opening the palette takes focus away at once, and the
 * palette gives it back to that element when it closes, as it did when it opened from that element.
 */
let held: HTMLElement | null = null

/** Called as the palette is asked to open: the focused element stops receiving keys and is kept to return to. */
export function holdFocusForPalette(): void {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  held = active instanceof HTMLElement && active !== document.body ? active : null
  held?.blur()
}

/** The element the palette should give focus back to on close, once; null when none was held. */
export function takeHeldFocus(): HTMLElement | null {
  const element = held
  held = null
  return element?.isConnected ? element : null
}
