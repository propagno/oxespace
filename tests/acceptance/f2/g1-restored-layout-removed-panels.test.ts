// Frozen acceptance test for the 1.5.0 F2 gap G1, renderer side (OXE program, phase F2, task FE-G1). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-gaps-FRONTEND.json (FE-G1).
// A 1.4 install restores what it saved in localStorage. After the removals, main drops panes of removed types (BACKEND
// G1-be), so the saved split tree, the sidebar's expanded sections and the Settings destination may name things that no
// longer exist. Each opens normally and drops them.
// Contract: src/components/Settings/SettingsCenter.tsx exports restoreSettingsDestination(saved, workspaceIds), the pure
// rule its first render uses (resolveAppPage already does it for application pages).
import { afterEach, describe, expect, test } from 'vitest'

type Node = { kind: 'leaf'; paneId: string } | { kind: 'split'; direction: 'horizontal' | 'vertical'; children: Node[]; sizes?: number[] }
const leaf = (paneId: string): Node => ({ kind: 'leaf', paneId })
const ids = (node: Node | null | undefined): string[] => !node ? [] : node.kind === 'leaf' ? [node.paneId] : node.children.flatMap(ids)
const pane = (id: string, rowIndex: number, columnIndex: number) => ({ id, rowIndex, columnIndex, type: 'terminal' }) as never

afterEach(() => { localStorage.clear() })

describe('G1 · a restored 1.4 layout that names removed panels opens and drops them', () => {
  test('a saved split tree with panes main no longer returns opens with the panes that remain, and no empty cell', async () => {
    // 1.4 saved three cells; the middle one was a pane main now drops.
    const saved: Node = { kind: 'split', direction: 'horizontal', sizes: [33, 34, 33], children: [leaf('p1'), leaf('p-removed'), { kind: 'split', direction: 'vertical', children: [leaf('p-removed-2'), leaf('p3')] }] }
    localStorage.setItem('oxe-pane-layout-trees-v1', JSON.stringify({ state: { trees: { 'ws-1': saved } }, version: 0 }))
    const { usePaneLayoutStore } = await import('../../../src/store/pane-layout.store')
    await usePaneLayoutStore.persist.rehydrate()
    expect(() => usePaneLayoutStore.getState().sync('ws-1', [pane('p1', 0, 0), pane('p3', 0, 1)])).not.toThrow()
    const tree = usePaneLayoutStore.getState().trees['ws-1'] as Node
    expect(ids(tree).sort()).toEqual(['p1', 'p3'])
    // No split is left holding a single child, so no cell renders empty.
    const singleChildSplits = (node: Node): number => node.kind === 'leaf' ? 0 : (node.children.length < 2 ? 1 : 0) + node.children.reduce((sum, child) => sum + singleChildSplits(child), 0)
    expect(singleChildSplits(tree)).toBe(0)
  })

  test('a saved sidebar with sections of removed modes keeps its width and density and loads without them', async () => {
    localStorage.setItem('oxe.navigation', JSON.stringify({ state: { width: 300, threadDensity: 'compact', expanded: { 'mode:pods': true, 'mode:post': false, 'ws-1': true, team: true } }, version: 0 }))
    const { useNavigationPrefs } = await import('../../../src/store/navigation-prefs.store')
    await useNavigationPrefs.persist.rehydrate()
    const state = useNavigationPrefs.getState()
    expect(state.width).toBe(300)
    expect(state.threadDensity).toBe('compact')
    expect(state.expanded['ws-1']).toBe(true)
  })

  test('a saved Settings destination on a removed page opens the first page of that scope', async () => {
    const { restoreSettingsDestination } = await import('../../../src/components/Settings/SettingsCenter') as unknown as {
      restoreSettingsDestination: (saved: unknown, workspaceIds: string[]) => { scope: string; page: string; workspaceId?: string }
    }
    expect(typeof restoreSettingsDestination).toBe('function')
    const { SETTINGS_PAGES } = await import('../../../src/components/Workspace/workspaceSettingsPages')
    // The workspace Memory page went with R5; the destination keeps the workspace and opens its first page.
    expect(restoreSettingsDestination({ scope: 'workspace', workspaceId: 'ws-1', page: 'memory' }, ['ws-1'])).toEqual({ scope: 'workspace', workspaceId: 'ws-1', page: SETTINGS_PAGES[0].id })
    expect(restoreSettingsDestination({ scope: 'application', page: 'automations' }, ['ws-1'])).toMatchObject({ scope: 'application' })
    expect(restoreSettingsDestination({ scope: 'application', page: 'automations' }, ['ws-1']).page).not.toBe('automations')
    expect(restoreSettingsDestination('not json at all', [])).toMatchObject({ scope: 'application' })
  }, 30_000)
})
