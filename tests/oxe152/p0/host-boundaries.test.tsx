// Frozen acceptance test for 1.5.2 P0 (Jira OXE-366; A12). Written by the planner; the executor must not edit it.
// src/main.tsx itself is loaded, with the app and the six global hosts replaced by stand-ins of which one throws while
// rendering. The app must stay on screen and the crash must be reported to the journal (reportRendererError). Each
// host has a boundary of its own: one host's crash does not take the other five away.
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ broken: '', reported: [] as Array<{ kind: string; errorName: string }>, roots: [] as Array<{ unmount(): void }> }))
const host = vi.hoisted(() => (name: string) => function Host() {
  if (state.broken === name) throw Object.assign(new Error('render failed'), { name: 'HostRenderError' })
  return <i data-host={name} />
})
vi.mock('react-dom/client', async importOriginal => {
  const real = await importOriginal<typeof import('react-dom/client')>()
  const createRoot: typeof real.createRoot = (...args) => { const root = real.createRoot(...args); state.roots.push(root); return root }
  return { ...real, createRoot, default: { ...real, createRoot } }
})
vi.mock('../../../src/App', () => ({ App: () => <p>OXESpace is on screen</p> }))
vi.mock('../../../src/components/Keyboard/ShortcutGuideHost', () => ({ ShortcutGuideHost: host('shortcuts') }))
vi.mock('../../../src/components/Keyboard/TerminalFocusHost', () => ({ TerminalFocusHost: host('terminal-focus') }))
vi.mock('../../../src/components/Diagnostics/ReportProblemHost', () => ({ ReportProblemHost: host('report-problem') }))
vi.mock('../../../src/components/About/AboutHost', () => ({ AboutHost: host('about') }))
vi.mock('../../../src/components/Updates/whatsNew', () => ({ WhatsNewHost: host('whats-new') }))
vi.mock('../../../src/components/Approvals/ApprovalsHost', () => ({ ApprovalsHost: host('approvals') }))
vi.mock('../../../src/lib/startupTiming', () => ({ StartupInteractiveMark: () => null }))

const HOSTS = ['shortcuts', 'terminal-focus', 'report-problem', 'about', 'whats-new', 'approvals']

beforeEach(() => {
  vi.resetModules()
  state.reported = []
  document.body.innerHTML = '<div id="root"></div>'
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never
  window.oxe = {
    app: { startupFailure: async () => null, onCloseRequested: () => () => undefined },
    diagnostics: { reportRendererError: (input: { kind: string; errorName: string }) => { state.reported.push(input) } }
  } as never
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  act(() => { for (const root of state.roots.splice(0)) root.unmount() })
  vi.restoreAllMocks()
})

async function appSurvives(broken: string): Promise<void> {
  state.broken = broken
  await import('../../../src/main')
  await vi.waitFor(() => expect(state.roots).toHaveLength(1), { timeout: 5_000 })
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(document.body.textContent, 'the app is still on screen').toContain('OXESpace is on screen')
  for (const other of HOSTS.filter(name => name !== broken)) expect(document.querySelector(`[data-host="${other}"]`), `${other} is still mounted`).not.toBeNull()
  await vi.waitFor(() => expect(state.reported).toContainEqual(expect.objectContaining({ kind: 'boundary', errorName: 'HostRenderError' })), { timeout: 5_000 })
}

describe('OXE-366 · a global host never takes the app down', () => {
  test('a crash in the shortcut guide host leaves the app on screen and is reported', async () => { await appSurvives('shortcuts') }, 30_000)
  test('a crash in the terminal focus host leaves the app on screen and is reported', async () => { await appSurvives('terminal-focus') }, 30_000)
  test('a crash in the report a problem host leaves the app on screen and is reported', async () => { await appSurvives('report-problem') }, 30_000)
  test('a crash in the About host leaves the app on screen and is reported', async () => { await appSurvives('about') }, 30_000)
  test('a crash in the What is new host leaves the app on screen and is reported', async () => { await appSurvives('whats-new') }, 30_000)
  test('a crash in the approvals host leaves the app on screen and is reported', async () => { await appSurvives('approvals') }, 30_000)
})
