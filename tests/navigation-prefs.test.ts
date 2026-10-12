import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { localStorage.clear(); vi.resetModules() })

describe('shared navigation preferences', () => {
  it('keeps existing Code width and group preferences when migrating Thread', async () => {
    localStorage.setItem('oxe.navigation', JSON.stringify({ state: { width: 304, expanded: { repo: true } }, version: 0 }))
    localStorage.setItem('oxe.thread-navigation', JSON.stringify({ state: { width: 312, collapsed: true }, version: 0 }))
    const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
    const { useUIStore } = await import('../src/store/ui.store')
    expect(useNavigationPrefs.getState().width).toBe(304)
    expect(useNavigationPrefs.getState().expanded).toEqual({ repo: true })
    expect(useUIStore.getState().isSidebarCollapsed).toBe(true)
    expect(localStorage.getItem('oxe.sidebar.collapsed')).toBe('true')
  })
  it('adopts Thread-only preferences, with existing Code collapse taking precedence', async () => {
    localStorage.setItem('oxe.thread-navigation', JSON.stringify({ state: { width: 296, collapsed: true }, version: 0 }))
    localStorage.setItem('oxe.sidebar.collapsed', 'false')
    const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
    const { useUIStore } = await import('../src/store/ui.store')
    expect(useNavigationPrefs.getState().width).toBe(296)
    expect(JSON.parse(localStorage.getItem('oxe.navigation')!).state.width).toBe(296)
    expect(useUIStore.getState().isSidebarCollapsed).toBe(false)
    useUIStore.getState().toggleSidebar()
    expect(localStorage.getItem('oxe.sidebar.collapsed')).toBe('true')
  })
  it('recovers corrupt preferences without carrying invalid geometry into the shell', async () => {
    localStorage.setItem('oxe.thread-navigation', '{broken')
    localStorage.setItem('oxe.navigation', JSON.stringify({ state: { width: 'wide', expanded: { repo: 'yes' } }, version: 0 }))
    const { useNavigationPrefs } = await import('../src/store/navigation-prefs.store')
    expect(useNavigationPrefs.getState().width).toBe(280)
    expect(useNavigationPrefs.getState().expanded).toEqual({})
  })
})
