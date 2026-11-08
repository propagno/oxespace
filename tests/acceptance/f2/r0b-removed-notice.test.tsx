// v2 — F8 CR: Agora is the start screen. A remembered post view now lands on Agora (DESIGN 1.5.0-f8-design.md U8.1,
// which supersedes F2's OxeCode fallback), checked through initialAppView instead of App.tsx's text. Everything else is v1.
// Frozen acceptance test for 1.5.0 R0b, renderer side (OXE program, phase F2, task FE-R0b). Written by the planner; the
// executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R0b); copy by DESIGN.
// Contract:
// - src/components/Updates/RemovedFeaturesBand.tsx exports RemovedFeaturesBand (no props). It reads
//   window.oxe.dataExport.state() → { upgrade, file, exportedAt, shownNotice, error, removed } (BACKEND R0b, #678) and
//   renders nothing on a fresh install or once shown. Its root carries data-intent="info" | "warning".
// - Dismiss and closing the "What changed in 1.5" dialog call dataExport.markNoticeShown(); Open / Show in folder call
//   dataExport.open() / dataExport.reveal(); Try now calls dataExport.exportAgain().
// - src/components/Settings/DataSettings.tsx exports DataSettings (no props), the "Removed in 1.5" section.
// - App.tsx mounts <RemovedFeaturesBand /> once.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
// Modules this task creates load at run time, so a missing one fails its own checks, not the whole file.
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(ROOT, `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

type Removed = { id: string; hadData: boolean; hadSettings: boolean }
interface State { upgrade: boolean; file: string | null; exportedAt: string | null; shownNotice: boolean; error: string | null; removed: Removed[] }
const FILE = 'C:/Users/me/AppData/Roaming/oxespace/exports/1.5-removed-20261108.json'
const had = (...ids: string[]): Removed[] => ids.map(id => ({ id, hadData: true, hadSettings: false }))

function mockMain(state: Partial<State>) {
  const api = {
    state: vi.fn(async (): Promise<State> => ({ upgrade: true, file: FILE, exportedAt: '2026-11-08T10:00:00.000Z', shownNotice: false, error: null, removed: [], ...state })),
    markNoticeShown: vi.fn(async () => undefined),
    exportAgain: vi.fn(async () => ({ file: FILE })),
    open: vi.fn(async () => undefined),
    reveal: vi.fn(async () => undefined)
  }
  Object.assign(window, { oxe: { dataExport: api, app: { platform: 'win32' } } })
  return api
}

async function renderBand(): Promise<void> {
  const { RemovedFeaturesBand } = await load<{ RemovedFeaturesBand: () => JSX.Element }>('src/components/Updates/RemovedFeaturesBand')
  render(<RemovedFeaturesBand />)
}
const band = (): Promise<HTMLElement> => screen.findByText(/OXESpace 1\.5 removed some features\./)
async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: 'See what changed' }))
  return screen.findByRole('dialog', { name: 'What changed in 1.5' })
}

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('R0b · what left in 1.5.0: the band, its dialog and Settings › Data', () => {
  test('the first 1.5.0 open after an upgrade shows the removed-features band once, under the title bar', async () => {
    mockMain({ removed: had('oxepost') })
    await renderBand()
    expect((await band()).textContent).toMatch(/OXESpace 1\.5 removed some features\. Your data was saved\./)
    expect(read('src/App.tsx').match(/<RemovedFeaturesBand\b/g)).toHaveLength(1)
  })

  test('What changed in 1.5 lists a row for each removed feature this install had, plus File editing and Skills manager, each with where it went', async () => {
    mockMain({ removed: had('oxepost', 'memory') })
    await renderBand()
    const dialog = within(await openDialog())
    expect(dialog.getByText(/OxePost/)).toBeInTheDocument()
    expect(dialog.getByText(/HTTP calls panel/)).toBeInTheDocument()
    expect(dialog.getByText(/AI Memory/)).toBeInTheDocument()
    expect(dialog.getByText(/File editing/)).toBeInTheDocument()
    expect(dialog.getByText(/Skills manager/)).toBeInTheDocument()
    expect(dialog.queryByText(/Linear/)).toBeNull()
    expect(dialog.queryByText(/OxePod/)).toBeNull()
  })

  test('an upgrade that used no removed feature still shows the band, with File editing and Skills manager only', async () => {
    mockMain({ removed: [], file: null, exportedAt: null })
    await renderBand()
    await band()
    const dialog = within(await openDialog())
    expect(dialog.getByText(/File editing/)).toBeInTheDocument()
    expect(dialog.getByText(/Skills manager/)).toBeInTheDocument()
    expect(dialog.queryByText(/OxePost|AI Memory|Automations|Teams|Linear/)).toBeNull()
  })

  test('the dialog names the export file with Open and Show in folder when one was written', async () => {
    const main = mockMain({ removed: had('oxepost', 'automations') })
    await renderBand()
    const dialog = within(await openDialog())
    const name = dialog.getByText('1.5-removed-20261108.json')
    expect(name.closest('[title]')?.getAttribute('title')).toBe(FILE)
    expect(dialog.getByText(/OxePost requests of your open workspaces/)).toBeInTheDocument()
    expect(dialog.getByText(/Secrets aren't in the file/)).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Open' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Show in folder' }))
    expect(main.open).toHaveBeenCalledTimes(1)
    expect(main.reveal).toHaveBeenCalledTimes(1)
  })

  test('with nothing exported the dialog says nothing needed saving and offers no file buttons', async () => {
    mockMain({ removed: had('teams'), file: null, exportedAt: null })
    await renderBand()
    const dialog = within(await openDialog())
    expect(dialog.getByText('Nothing needed saving.')).toBeInTheDocument()
    expect(dialog.queryByRole('button', { name: 'Open' })).toBeNull()
    expect(dialog.queryByRole('button', { name: 'Show in folder' })).toBeNull()
  })

  test('a failed export turns the band to a warning with Try now, and the dialog says nothing was deleted', async () => {
    const main = mockMain({ removed: had('oxepost'), file: null, exportedAt: null, error: 'the exports folder is read-only' })
    await renderBand()
    const text = await screen.findByText(/Your data isn't saved yet\./)
    expect(text.closest('[data-intent]')?.getAttribute('data-intent')).toBe('warning')
    const dialog = within(await openDialog())
    expect(dialog.getByText(/Couldn't save your data: the exports folder is read-only\. Nothing was deleted/)).toBeInTheDocument()
    await userEvent.click(dialog.getByRole('button', { name: 'Try now' }))
    expect(main.exportAgain).toHaveBeenCalledTimes(1)
  })

  test('dismissing the band or closing the dialog keeps it from coming back', async () => {
    const main = mockMain({ removed: had('oxepost') })
    await renderBand()
    await band()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText(/OXESpace 1\.5 removed some features\./)).toBeNull())
    expect(main.markNoticeShown).toHaveBeenCalledTimes(1)
    cleanup()

    const again = mockMain({ removed: had('oxepost') })
    await renderBand()
    const dialog = await openDialog()
    const close = within(dialog).getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement
    await userEvent.click(close)
    await waitFor(() => expect(again.markNoticeShown).toHaveBeenCalled())
    cleanup()

    mockMain({ removed: had('oxepost'), shownNotice: true })
    await renderBand()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByText(/OXESpace 1\.5 removed some features\./)).toBeNull()
  })

  test('a fresh install never shows the band', async () => {
    mockMain({ upgrade: false, removed: [], file: null, exportedAt: null })
    await renderBand()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByText(/OXESpace 1\.5 removed some features\./)).toBeNull()
  })

  test('a remembered post view opens Agora and shows the band once', async () => {
    const { lazyView } = await import('../../../src/lib/idlePreload')
    expect(lazyView('post')).toBeNull()
    expect(lazyView('pods')).toBeNull()
    const { APP_VIEWS } = await import('../../../src/keyboard/keybindings')
    expect(APP_VIEWS as readonly string[]).not.toContain('post')
    // v2 (F8 CR): the start view is Agora, read from initialAppView rather than from App.tsx's text.
    const { initialAppView } = await load<{ initialAppView: (remembered: string | null) => string }>('src/app/startView')
    expect(initialAppView('post')).toBe('agora')
    mockMain({ removed: had('oxepost') })
    await renderBand()
    expect(await band()).toBeInTheDocument()
  })

  test('Settings › Data exports again and shows the last export with Show in folder', async () => {
    const main = mockMain({ removed: had('oxepost') })
    const { DataSettings } = await load<{ DataSettings: () => JSX.Element }>('src/components/Settings/DataSettings')
    render(<DataSettings />)
    expect(await screen.findByText('Removed in 1.5')).toBeInTheDocument()
    expect(screen.getByText('Export removed data')).toBeInTheDocument()
    await waitFor(() => expect(document.body.textContent).toMatch(/Saved .*1\.5-removed-20261108\.json/))
    await userEvent.click(screen.getByRole('button', { name: 'Show in folder' }))
    expect(main.reveal).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: /Export…/ }))
    expect(main.exportAgain).toHaveBeenCalledTimes(1)
  })

  test('the band is announced as a status and the band and dialog work by keyboard, in en and pt-BR', async () => {
    const main = mockMain({ removed: had('oxepost') })
    await renderBand()
    const status = (await band()).closest('[role="status"]')
    expect(status).not.toBeNull()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'See what changed' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus()
    await userEvent.tab({ shift: true })
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'What changed in 1.5' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(main.markNoticeShown).toHaveBeenCalled()
    cleanup()

    await changeLanguage('pt-BR')
    mockMain({ removed: had('oxepost') })
    await renderBand()
    expect(await screen.findByText(/O OXESpace 1\.5 removeu alguns recursos\. Seus dados foram salvos\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver o que mudou' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dispensar' })).toBeInTheDocument()
  })
})
