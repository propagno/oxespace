/**
 * F6 and Shift+F6 move focus between the window's regions, in this order: the title bar (its menus), the mode
 * switch, the sidebar (its filter and list; the divider that resizes it is not a stop), the work area (the pane grid in Code, the conversation in Thread, the view itself in
 * OxeQuery, OxePod and OxePost), the side panels, then the status bar, and round again. A region that is
 * not on screen is skipped. Focus lands where F6 last left that region (a terminal pane, for the grid), else
 * on the region's first control. Loaded on the first F6 (src/components/Keyboard/TerminalFocusHost.tsx).
 */
const REGIONS = [
  '.workbench-titlebar',
  // A region inside another (the mode switch in the title bar) is a stop of its own.
  '[data-focus-region]',
  '.app-shell > aside',
  '.workspace-host:not(.workspace-host-hidden) .workspace-grid',
  '.workspace-host:not(.workspace-host-hidden) .workspace-split-grid',
  '.thread-host',
  '.oq-host',
  '.pod-host',
  '.post-host',
  '.workspace-host:not(.workspace-host-hidden) .workspace-panel-stack',
  '.app-statusbar'
].join(', ')

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The last element focused inside each region. */
const lastFocused = new WeakMap<Element, HTMLElement>()
/** Regions that hold a tabindex only because F6 gave them one, to take focus with nothing else to focus. */
const lent = new Set<HTMLElement>()

/**
 * Without the system's focus, focus moves fire no events at all, so while a tabindex is lent a check every
 * WATCH_MS takes it back once focus is no longer in its region. It stops when nothing is lent. A timer, not
 * animation frames: Chromium pauses those in a window it counts as hidden or covered (a Windows CI runner).
 */
const WATCH_MS = 100
let watching = false
function watchLent(): void {
  if (watching) return
  watching = true
  const tick = (): void => {
    for (const region of lent) {
      if (region.contains(document.activeElement)) continue
      region.removeAttribute('tabindex')
      lent.delete(region)
    }
    if (lent.size) setTimeout(tick, WATCH_MS)
    else watching = false
  }
  setTimeout(tick, WATCH_MS)
}

/** Takes back the tabindex F6 lent, from every region but `keep`. */
function returnTabindexes(keep?: HTMLElement): void {
  for (const region of lent) {
    if (region === keep) continue
    region.removeAttribute('tabindex')
    lent.delete(region)
  }
}

const shown = (element: Element): boolean => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"], [hidden], [inert]')

export function focusRegions(root: ParentNode = document): HTMLElement[] {
  // querySelectorAll returns document order, which is the order of the regions on screen.
  return [...root.querySelectorAll<HTMLElement>(REGIONS)].filter(shown)
}

/** The innermost region holding the element: a nested region comes after its parent in document order. */
const regionOf = (element: Element | null, regions: HTMLElement[]): HTMLElement | undefined =>
  element ? regions.filter(region => region.contains(element)).at(-1) : undefined

/** Where F6 may land in a region: shown, not a divider (it resizes, it is not a place), not inside a nested region. */
const landing = (region: HTMLElement, regions: HTMLElement[]) => (element: HTMLElement): boolean =>
  shown(element) && !element.matches('[role="separator"]') && regionOf(element, regions) === region

function enter(region: HTMLElement, regions: HTMLElement[]): void {
  const last = lastFocused.get(region)
  const target = last && last.isConnected && region.contains(last) && shown(last) ? last
    : [...region.querySelectorAll<HTMLElement>(TABBABLE)].find(landing(region, regions))
  if (target) { target.focus(); return }
  // A region with nothing to focus still takes focus, so the next F6 knows where it is. The tabindex goes again
  // when focus leaves it, so it does not stay in the page for Tab order and screen-reader navigation. A window
  // without the system's focus (a CI runner, another app in front) moves focus without blur events, so the next
  // F6 also takes it back, and so does a later focusout.
  if (!region.hasAttribute('tabindex')) {
    region.tabIndex = -1
    lent.add(region)
    watchLent()
    region.addEventListener('focusout', () => { if (lent.delete(region)) region.removeAttribute('tabindex') }, { once: true })
  }
  region.focus()
}

/** Moves focus to the next (1) or previous (-1) region; false when there is none or a dialog or menu holds focus. */
export function moveFocusRegion(direction: 1 | -1, from: Element | null = document.activeElement): boolean {
  // A modal dialog or an open menu keeps focus until it closes (Escape); F6 does not leave it.
  if (from?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return false
  const regions = focusRegions()
  if (regions.length === 0) return false
  const current = regionOf(from, regions)
  if (current && from instanceof HTMLElement && from !== current) lastFocused.set(current, from)
  const index = current ? regions.indexOf(current) : direction === 1 ? -1 : 0
  const target = regions[(index + direction + regions.length) % regions.length]
  returnTabindexes(target)
  enter(target, regions)
  return true
}
