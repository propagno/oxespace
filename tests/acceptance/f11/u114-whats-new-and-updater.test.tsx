// Frozen acceptance test for 1.5.0 A39 on screen (DESIGN U11.4, OXE program, phase F11, task FE-A39). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f11-design.md (U11.4).
// Window only (BACKEND #724: What's new and the updater's hold are the window's). The renderer parts:
// - WhatsNewDialog({ onClose(), onOpen(target: 'browser' | 'approvals' | 'httpCalls' | 'timeTravel') }) in
//   src/components/Updates/WhatsNewDialog.tsx (U1 md, four rows, one Open each);
// - the Help menu item help.whats-new (MENU_ACTION_IDS, src/components/Navigation/appMenus.ts);
// - useWhatsNew (zustand: { open, show(), close() }) and WhatsNewHost() in src/components/Updates/whatsNew.tsx: the dialog
//   opens only when asked (Help, About, or the F2 band's dialog link "See what's new"), never by itself;
// - on an upgrade F2's RemovedFeaturesBand (window.oxe.dataExport.state(), #678) stays the only band (HML-725-1);
// - updateChipView(state: AppUpdateState, context: { criticalHold: boolean }) → { label, actions: string[] } | null in
//   src/components/Updates/updateChip.ts, the four states' copy, and null while a critical approval holds (F7).
// The release notes, installers, the downgrade screen and the phone (U11.4a, c, d; A40; A41) are DESIGN's and HML's
// reads of the RC; the four states' shots are the visual run.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Row = Record<string, unknown>
type Chip = { label: string; actions: string[] } | null
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const state = (extra: Row) => ({ status: 'idle', currentVersion: '1.4.3', availableVersion: '1.5.0', progress: null, error: null, lastCheckedAt: 1, ...extra })
async function chip() {
  return (await load<{ updateChipView: (state: Row, context: { criticalHold: boolean }) => Chip }>('src/components/Updates/updateChip')).updateChipView
}

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe("U11.4 · What's new and the updater", () => {
  test("What's new shows four rows, one per pillar, each with its line and an Open that lands on its screen", async () => {
    const { WhatsNewDialog } = await load<{ WhatsNewDialog: (props: Row) => JSX.Element }>('src/components/Updates/WhatsNewDialog')
    const onOpen = vi.fn()
    render(<WhatsNewDialog onClose={vi.fn()} onOpen={onOpen} />)
    const dialog = await screen.findByRole('dialog', { name: "What's new in 1.5" })
    const lines = [
      ['browser', 'Watch the agent drive your app, on desktop or a phone size.'],
      ['approvals', 'Approve with the impact in front of you; irreversible steps hold.'],
      ['httpCalls', 'Every HTTP call your agents made, with secrets masked.'],
      ['timeTravel', 'Go back to any checkpoint, or branch from it.']
    ]
    const opens = within(dialog).getAllByRole('button', { name: /^Open/ })
    expect(opens).toHaveLength(4)
    for (const [index, [target, line]] of lines.entries()) {
      expect(within(dialog).getByText(line)).toBeInTheDocument()
      await userEvent.click(opens[index])
      expect(onOpen).toHaveBeenLastCalledWith(target)
    }
  })

  test("Help has What's new in 1.5", async () => {
    const { buildAppMenus, MENU_ACTION_IDS } = await import('../../../src/components/Navigation/appMenus')
    expect(MENU_ACTION_IDS as readonly string[]).toContain('help.whats-new')
    const run = vi.fn()
    const actions = (MENU_ACTION_IDS as readonly string[]).map(id => ({ id, title: id === 'help.whats-new' ? "What's new in 1.5" : id, category: 'Test', run }))
    const menus = buildAppMenus({ actions, applicationView: 'code', setApplicationView: vi.fn(), openSettings: vi.fn(), addThreadProject: vi.fn(), openCommandMenu: vi.fn() } as never)
    const help = menus.find(menu => menu.id === 'help')!
    expect(help.items.some(item => item.kind === 'item' && item.id === 'help.whats-new')).toBe(true)
  })

  test('the updater reads its four states, with Restart now and Later when ready and the releases page when it fails', async () => {
    const view = await chip()
    const free = { criticalHold: false }
    expect(view(state({ status: 'available' }), free)).toEqual({ label: 'Update to 1.5.0', actions: [] })
    expect(view(state({ status: 'downloading', progress: 42 }), free)).toEqual({ label: 'Downloading 1.5.0… 42%', actions: [] })
    expect(view(state({ status: 'downloaded' }), free)).toEqual({ label: 'Restart to update', actions: ['Restart now', 'Later'] })
    expect(view(state({ status: 'error', error: 'net' }), free)).toEqual({ label: "The update couldn't download. Try again later or get it from the releases page.", actions: ['Open releases page'] })
    expect(view(state({ status: 'idle' }), free)).toBeNull()
  })

  test('no updater chip shows while a critical approval holds; it comes back after', async () => {
    const view = await chip()
    for (const status of ['available', 'downloading', 'downloaded', 'error']) expect(view(state({ status, progress: 10 }), { criticalHold: true }), status).toBeNull()
    expect(view(state({ status: 'downloaded' }), { criticalHold: false })).not.toBeNull()
  })

  test("What's new and the updater read in pt-BR", async () => {
    await changeLanguage('pt-BR')
    const { WhatsNewDialog } = await load<{ WhatsNewDialog: (props: Row) => JSX.Element }>('src/components/Updates/WhatsNewDialog')
    render(<WhatsNewDialog onClose={vi.fn()} onOpen={vi.fn()} />)
    const dialog = await screen.findByRole('dialog', { name: 'Novidades da 1.5' })
    expect(within(dialog).getByText('Volte a qualquer checkpoint ou ramifique a partir dele.')).toBeInTheDocument()
    const view = await chip()
    expect(view(state({ status: 'downloaded' }), { criticalHold: false })).toEqual({ label: 'Reinicie para atualizar', actions: ['Reiniciar agora', 'Depois'] })
    expect(view(state({ status: 'downloading', progress: 7 }), { criticalHold: false })?.label).toBe('Baixando 1.5.0… 7%')
  })

  test("an upgraded profile gets one band only: F2's band, whose dialog links What's new, and no second band after it is dismissed", async () => {
    const dataExport = {
      state: vi.fn(async () => ({ upgrade: true, file: null, exportedAt: null, shownNotice: false, error: null, removed: [] })),
      markNoticeShown: vi.fn(async () => undefined), exportAgain: vi.fn(async () => ({ file: null })), open: vi.fn(async () => undefined), reveal: vi.fn(async () => undefined)
    }
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, dataExport } })
    const { RemovedFeaturesBand } = await load<{ RemovedFeaturesBand: () => JSX.Element }>('src/components/Updates/RemovedFeaturesBand')
    const { WhatsNewHost } = await load<{ WhatsNewHost: () => JSX.Element }>('src/components/Updates/whatsNew')
    const { Toaster } = await import('../../../src/ui/Toast')
    render(<><RemovedFeaturesBand /><WhatsNewHost /><Toaster /></>)
    expect(await screen.findByText(/OXESpace 1\.5 removed some features\./)).toBeInTheDocument()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryAllByText(/What's new/)).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'See what changed' }))
    const changed = await screen.findByRole('dialog', { name: 'What changed in 1.5' })
    await userEvent.click(within(changed).getByText("See what's new").closest('a, button') as HTMLElement)
    expect(await screen.findByRole('dialog', { name: "What's new in 1.5" })).toBeInTheDocument()
    cleanup()
    dataExport.state.mockResolvedValue({ upgrade: true, file: null, exportedAt: null, shownNotice: true, error: null, removed: [] })
    render(<><RemovedFeaturesBand /><WhatsNewHost /><Toaster /></>)
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.queryByText(/OXESpace 1\.5 removed some features\./)).toBeNull()
    expect(screen.queryAllByText(/What's new/)).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

})
