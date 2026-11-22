// Frozen acceptance test for 1.5.2 HML fixes (Jira OXE-348 part A, HML round 2 P0 perf, on f65fa5374). Written by the
// planner; the executor must not edit it. Part B (ThreadView re-rendering on each key) waits for OxeChat F5's
// composer and turn footer (#1023–#1025), which replace that code.
// The bug: App subscribes to the whole thread snapshot, so every streaming chunk re-renders the whole window; the
// OxeCode panel list is a new array on every App render (WorkspaceSurface's memo never holds); the command menu and the
// usage dialog are mounted at boot, so their lazy chunks load before first paint.
// SOURCE-TEXT (rigor: source-assertion): jsdom cannot count renders of the whole App; these checks read src/App.tsx.
// The measured effect is HML's perceived-perf round (e2e/perceived-perf.spec.ts), not this file.
// Contract (src/App.tsx):
// - no subscription to the whole snapshot: useThreadStore(state => state.snapshot) is gone; App reads only the fields
//   it shows (thread id, projectId, workspaceId, rootPath, provider, mcpServers), e.g. with useShallow; App.tsx is at its
//   size limit, so a helper hook may live in src/app/ (e.g. src/app/useAppThread.ts), which must not subscribe to the
//   whole snapshot either;
// - codePanelItems is memoised (useMemo), so WorkspaceSurface gets the same array while nothing in it changed;
// - src/app/useAppThread.ts (new): useAppThread() returns the shown conversation's fields App needs ({ id, projectId,
//   workspaceId, rootPath, provider, mcpServers }, null without one); a snapshot that changes only its events (a
//   streaming chunk) does not re-render the component that calls it.
// - <CommandMenu> and <UsageModal> render only while their open flag is true (isCommandMenuOpen, isUsageOpen).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { act, renderHook } from '@testing-library/react'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { App } from '../../../src/App'
import { useThreadStore } from '../../../src/store/thread.store'

const app = (): string => readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8').replace(/\r\n/g, '\n')
/** The source before the first `<Tag` up to the previous JSX boundary, enough to see the condition that guards it. */
function guardOf(text: string, tag: string): string {
  const at = text.indexOf(`<${tag}`)
  if (at < 0) throw new Error(`App.tsx does not render <${tag}>`)
  return text.slice(Math.max(0, at - 160), at)
}

describe('OXE-348 A · Streaming in OxeChat does not re-render the whole window', () => {
  test('App does not subscribe to the whole thread snapshot', () => {
    const helpers = readdirSync(join(process.cwd(), 'src/app')).filter(name => /\.tsx?$/.test(name))
    for (const name of helpers) expect(readFileSync(join(process.cwd(), 'src/app', name), 'utf8'), name).not.toMatch(/useThreadStore\(\s*\(?\s*state\s*\)?\s*=>\s*state\.snapshot\s*\)/)
    expect(app()).not.toMatch(/useThreadStore\(\s*\(?\s*state\s*\)?\s*=>\s*state\.snapshot\s*\)/)
  })

  test('a streaming chunk does not re-render what reads the conversation for the window', async () => {
    expect(typeof App).toBe('function')
    const file = ['.ts', '.tsx'].map(ext => join(process.cwd(), 'src/app/useAppThread' + ext)).find(candidate => existsSync(candidate))
    if (!file) throw new Error('src/app/useAppThread.ts does not exist yet')
    const { useAppThread } = await import(/* @vite-ignore */ pathToFileURL(file).href) as { useAppThread(): { id: string; rootPath: string } | null }
    const thread = { id: 't1', workspaceId: 'thread:p1', projectId: 'p1', rootPath: 'C:/dev/shop', provider: 'claude', title: 'Checkout', status: 'running', createdAt: 1, updatedAt: 1 }
    act(() => { useThreadStore.setState({ snapshot: { thread, events: [] } } as never) })
    let renders = 0
    const { result } = renderHook(() => { renders += 1; return useAppThread() })
    expect(result.current?.id).toBe('t1')
    expect(result.current?.rootPath).toBe('C:/dev/shop')
    const before = renders
    for (let chunk = 1; chunk <= 5; chunk++) act(() => { useThreadStore.setState({ snapshot: { thread: { ...thread, updatedAt: 1 + chunk }, events: Array.from({ length: chunk }, (_, i) => ({ type: 'message', id: 'm' + i })) } } as never) })
    expect(renders - before, 'renders caused by five streaming chunks').toBe(0)
    act(() => { useThreadStore.setState({ snapshot: { thread: { ...thread, id: 't2', rootPath: 'C:/dev/api' }, events: [] } } as never) })
    expect(result.current?.id).toBe('t2')
    act(() => { useThreadStore.setState({ snapshot: null } as never) })
  })

  test('the OxeCode panel list is memoised', () => {
    expect(app()).toMatch(/const\s+codePanelItems\b[^=]*=\s*useMemo\(/)
  })

  test('the command menu and the usage dialog mount only when open', () => {
    expect(guardOf(app(), 'CommandMenu')).toMatch(/isCommandMenuOpen\s*&&/)
    expect(guardOf(app(), 'UsageModal')).toMatch(/isUsageOpen\s*&&/)
  })
})
