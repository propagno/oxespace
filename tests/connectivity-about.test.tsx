import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppAbout, AppConnectivity } from '../shared/types/app'
import { resetConnectivity, useConnectivity } from '../src/hooks/useConnectivity'
import { aboutLinks, aboutText, AboutDialog } from '../src/components/About/AboutDialog'

const ABOUT: AppAbout = {
  name: 'OXESpace', version: '1.4.0', channel: 'stable', commit: 'abc1234', builtAt: '2026-10-30T12:00:00Z',
  versions: { electron: '44.9.3', chrome: '140.0', node: '22.1.0', v8: '14.0' }, platform: 'win32', arch: 'x64', osRelease: '10.0.26200',
  license: 'MIT', repositoryUrl: 'https://github.com/propagno/oxespace'
}

type AppApi = { connectivity?: () => Promise<AppConnectivity>; onConnectivity?: (listener: (state: AppConnectivity) => void) => () => void; about?: () => Promise<AppAbout>; version?: string }
const withApp = (app: AppApi): void => { (window as unknown as { oxe: { app: AppApi } }).oxe = { app } }

afterEach(() => { cleanup(); resetConnectivity(); delete (window as unknown as { oxe?: unknown }).oxe })

function Probe(): JSX.Element { return <p>{useConnectivity()}</p> }

describe('useConnectivity', () => {
  it('reads the main process once and follows what it pushes', async () => {
    let push: (state: AppConnectivity) => void = () => {}
    const connectivity = vi.fn(async (): Promise<AppConnectivity> => ({ state: 'offline', checkedAt: 1 }))
    withApp({ connectivity, onConnectivity: listener => { push = listener; return () => {} } })
    render(<><Probe /><Probe /></>)
    expect(await screen.findAllByText('offline')).toHaveLength(2)
    expect(connectivity).toHaveBeenCalledOnce()
    act(() => push({ state: 'online', checkedAt: 2 }))
    expect(screen.getAllByText('online')).toHaveLength(2)
  })

  it('stays unknown when the main process cannot say, so nothing claims offline', async () => {
    withApp({ connectivity: () => Promise.reject(new Error('no handler')) })
    render(<Probe />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('unknown')).toBeInTheDocument()
  })
})

describe('About OXESpace', () => {
  it('links a release to its tag and a dev run to main', () => {
    expect(aboutLinks(ABOUT)).toEqual({
      repository: 'https://github.com/propagno/oxespace',
      releaseNotes: 'https://github.com/propagno/oxespace/releases/tag/v1.4.0',
      license: 'https://github.com/propagno/oxespace/blob/v1.4.0/LICENSE',
      notices: 'https://github.com/propagno/oxespace/blob/v1.4.0/THIRD_PARTY_NOTICES.md'
    })
    expect(aboutLinks({ ...ABOUT, channel: 'dev' }).license).toBe('https://github.com/propagno/oxespace/blob/main/LICENSE')
  })

  it('copies the build as plain text, with no path, account or machine name', () => {
    expect(aboutText(ABOUT)).toBe('OXESpace 1.4.0 (stable)\nCommit: abc1234\nBuilt: 2026-10-30T12:00:00Z\nElectron 44.9.3 · Chromium 140.0 · Node.js 22.1.0 · V8 14.0\nWindows 10.0.26200 (x64)')
  })

  it('shows the version, channel and build facts from app:about', async () => {
    withApp({ about: async () => ABOUT })
    render(<AboutDialog onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: 'About OXESpace' })
    expect(await screen.findByText('abc1234')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Version 1.4.0')
    expect(dialog).toHaveTextContent('Stable')
    expect(dialog).toHaveTextContent('44.9.3')
    expect(screen.getByRole('button', { name: /Third-party licenses/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeInTheDocument()
  })

  it('still names the version when the build details are not available', async () => {
    withApp({ version: '1.3.3', about: () => Promise.reject(new Error('no handler')) })
    render(<AboutDialog onClose={() => {}} />)
    expect(await screen.findByText('The build details are not available in this version.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveTextContent('Version 1.3.3')
    expect(screen.queryByRole('button', { name: 'Copy details' })).toBeNull()
  })
})
