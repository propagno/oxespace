// Frozen acceptance test for 1.5.0 §6 tabs (DESIGN U4.8, OXE program, phase F4, task FE-P7). Written by the planner; the
// executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f4-design.md (U4.8).
// Contract: src/components/Threads/threadTabs.ts exports visibleThreadTabs(state) → the tab ids in order, from
// { changedFiles, panes, composePlace, httpCalls, pullRequest, done }. ThreadTabs({ threadId }) in
// src/components/Threads/ThreadTabs.tsx renders them from main (thread.places, thread.panes, httpAudit.list,
// pullRequest.state, and oxePod containers.list: a Compose project whose com.docker.compose.project.working_dir is a
// place) and reads again on thread.onPlacesChanged and the oxePod containers-changed event, so a tab appears without a reload.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

type TabsModel = { visibleThreadTabs: (state: Record<string, unknown>) => string[] }
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const EMPTY = { changedFiles: 0, panes: 0, composePlace: false, httpCalls: 0, pullRequest: false, done: false }

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('U4.8 · tabs that fill in', () => {
  test('a conversation with nothing else shows only Conversation, and Changes once it changed files', async () => {
    const { visibleThreadTabs } = await load<TabsModel>('src/components/Threads/threadTabs')
    expect(visibleThreadTabs(EMPTY)).toEqual(['conversation'])
    expect(visibleThreadTabs({ ...EMPTY, changedFiles: 2 })).toEqual(['conversation', 'changes'])
  })

  test('Terminal, Containers, Network and Pull request appear only when they have something', async () => {
    const { visibleThreadTabs } = await load<TabsModel>('src/components/Threads/threadTabs')
    expect(visibleThreadTabs({ ...EMPTY, panes: 1 })).toEqual(['conversation', 'terminal'])
    expect(visibleThreadTabs({ ...EMPTY, composePlace: true })).toEqual(['conversation', 'containers'])
    expect(visibleThreadTabs({ ...EMPTY, httpCalls: 3 })).toEqual(['conversation', 'network'])
    expect(visibleThreadTabs({ ...EMPTY, pullRequest: true })).toEqual(['conversation', 'pull-request'])
    expect(visibleThreadTabs({ ...EMPTY, done: true })).toEqual(['conversation', 'pull-request'])
    expect(visibleThreadTabs({ changedFiles: 1, panes: 1, composePlace: true, httpCalls: 1, pullRequest: true, done: false }))
      .toEqual(['conversation', 'changes', 'terminal', 'containers', 'network', 'pull-request'])
  })

  test('a Compose project running in a place makes Containers appear without a reload', async () => {
    let containers: unknown[] = []
    const podListeners: Array<(event: unknown) => void> = []
    const place = { id: 'pl-root', kind: 'root', path: '/repo', base: null, current: { branch: 'main', commit: 'abc' }, writes: 0, files: [], drift: null }
    const thread = {
      places: vi.fn(async () => ({ places: [place], capped: false, refused: 0 })),
      panes: vi.fn(async () => []),
      onPlacesChanged: vi.fn(() => () => undefined)
    }
    const oxePod = {
      call: vi.fn(async (op: string) => op === 'containers.list' ? { ok: true, value: { engine: 'docker', containers } } : { ok: true, value: null }),
      onEvent: vi.fn((listener: (event: unknown) => void) => { podListeners.push(listener); return () => undefined })
    }
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, thread, oxePod, httpAudit: { list: vi.fn(async () => ({ rows: [], cursor: null, hosts: [] })) }, pullRequest: { state: vi.fn(async () => ({ provider: 'github', cli: 'ok', pr: null })) } } })
    const { ThreadTabs } = await load<{ ThreadTabs: (props: { threadId: string }) => JSX.Element }>('src/components/Threads/ThreadTabs')
    render(<ThreadTabs threadId="t-1" />)
    expect(await screen.findByRole('tab', { name: 'Conversation' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Containers' })).toBeNull()
    // A Compose project whose working folder is one of this conversation's places starts.
    containers = [{ id: 'k1', name: 'repo-db-1', image: 'postgres:16', state: 'running', status: 'Up', ports: [], labels: { 'com.docker.compose.project.working_dir': '/repo', 'com.docker.compose.project': 'repo' } }]
    act(() => { for (const listener of podListeners) listener({ type: 'containers-changed' }) })
    expect(await screen.findByRole('tab', { name: 'Containers' })).toBeInTheDocument()
  })
})
