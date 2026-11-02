import type { Locator, Page } from '@playwright/test'

/**
 * The application modes by their internal id, never by the name on screen: the names belong to the copy
 * (OxeCode, OxeChat, OxeQuery, OxePod, OxePost, in either language) and change without breaking a spec.
 */
export type AppMode = 'code' | 'thread' | 'data' | 'pods' | 'post'

/** A mode's button in the mode switch. */
export function modeButton(page: Page, mode: AppMode): Locator {
  return page.locator(`button[data-app-mode="${mode}"]`)
}
