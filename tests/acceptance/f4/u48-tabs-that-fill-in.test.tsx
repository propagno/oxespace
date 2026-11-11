// Acceptance test for 1.5.0 §6 tabs (DESIGN U4.8, folded into ThreadToolTabs in F6 per TECH LEAD 08/11).
// F6 replaced ThreadTabs / visibleThreadTabs with ThreadToolTabs (src/components/Threads/ThreadToolTabs.tsx) and
// threadToolTabs (electron/main/services/conversation/thread-tool-tabs.ts).
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { threadToolTabs } from '../../../electron/main/services/conversation/thread-tool-tabs'
import { ThreadToolTabs } from '../../../src/components/Threads/ThreadToolTabs'
import type { ThreadToolTabEntry } from '../../../shared/types/ipc'

const EMPTY = { summary: { databases: 0, http: 0, containers: 0 }, files: 0, panes: 0, pullRequest: null }

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('U4.8 · tabs that fill in (folded into ThreadToolTabs in F6)', () => {
  test('a conversation with nothing else shows only Conversation, and Changes once it changed files', () => {
    expect(threadToolTabs(EMPTY).map(entry => entry.tab)).toEqual(['conversation'])
    expect(threadToolTabs({ ...EMPTY, files: 2 }).map(entry => entry.tab)).toEqual(['conversation', 'changes'])
  })

  test('Terminal, Containers, Network and Pull request appear only when they have something', () => {
    expect(threadToolTabs({ ...EMPTY, panes: 1 }).map(entry => entry.tab)).toEqual(['conversation', 'terminal'])
    expect(threadToolTabs({ ...EMPTY, summary: { ...EMPTY.summary, containers: 1 } }).map(entry => entry.tab)).toEqual(['conversation', 'containers'])
    expect(threadToolTabs({ ...EMPTY, summary: { ...EMPTY.summary, http: 3 } }).map(entry => entry.tab)).toEqual(['conversation', 'network'])
    expect(threadToolTabs({ ...EMPTY, pullRequest: { number: 42 } }).map(entry => entry.tab)).toEqual(['conversation', 'pullRequest'])
    expect(threadToolTabs({ summary: { databases: 0, http: 1, containers: 1 }, files: 1, panes: 1, pullRequest: { number: 42 } }).map(entry => entry.tab))
      .toEqual(['conversation', 'terminal', 'network', 'containers', 'changes', 'pullRequest'])
  })

  test('Containers appears in ThreadToolTabs once main reports container activity, without a reload', async () => {
    let tabs: ThreadToolTabEntry[] = [{ tab: 'conversation', count: null }]
    const listeners: Array<(event: { threadId?: string }) => void> = []
    const thread = {
      toolTabs: vi.fn(async () => tabs),
      onToolTabsChanged: vi.fn((listener: (event: { threadId?: string }) => void) => { listeners.push(listener); return () => undefined })
    }
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread } })
    render(<ThreadToolTabs threadId="t-1" />)
    expect(await screen.findByRole('tab', { name: /Conversation/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Containers/ })).toBeNull()
    tabs = [{ tab: 'conversation', count: null }, { tab: 'containers', count: 1 }]
    act(() => { for (const listener of listeners) listener({ threadId: 't-1' }) })
    expect(await screen.findByRole('tab', { name: /Containers/ })).toBeInTheDocument()
  })
})
