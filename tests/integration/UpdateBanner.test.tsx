import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UpdateBanner } from '../../src/components/Updates/UpdateBanner'
import { AppUpdateIndicator } from '../../src/components/Updates/AppUpdateIndicator'
import { useUpdaterStore } from '../../src/store/updater.store'

describe('UpdateBanner', () => {
  beforeEach(() => {
    useUpdaterStore.setState({
      app: {
        status: 'idle',
        currentVersion: '0.2.10',
        availableVersion: null,
        progress: null,
        error: null,
        lastCheckedAt: null
      },
      rtk: {
        installed: true,
        version: '1.0.0',
        latestVersion: '1.0.0',
        updateAvailable: false,
        binDir: '/tmp/bin',
        error: null,
        checking: false,
        updating: false,
        lastCheckedAt: Date.now()
      },
      dismissedVersion: null
    })

    window.oxe = {
      app: {
        version: '0.2.10',
        getUpdateState: vi.fn().mockResolvedValue(useUpdaterStore.getState().app),
        checkForUpdates: vi.fn(),
        quitAndInstall: vi.fn().mockResolvedValue(true),
        onUpdateState: vi.fn(() => () => undefined)
      },
      rtk: {
        getStatus: vi.fn().mockResolvedValue(useUpdaterStore.getState().rtk),
        checkForUpdate: vi.fn().mockResolvedValue(useUpdaterStore.getState().rtk),
        updateToLatest: vi.fn()
      }
    } as unknown as typeof window.oxe
  })

  test('renders nothing when up to date', async () => {
    render(<UpdateBanner />)
    await waitFor(() => {
      expect(screen.queryByTestId('rtk-update-indicator')).not.toBeInTheDocument()
    })
  })

  test('shows a titlebar update icon and restart action when downloaded', async () => {
    const user = userEvent.setup()
    useUpdaterStore.setState({
      app: {
        status: 'downloaded',
        currentVersion: '0.2.10',
        availableVersion: '0.2.11',
        progress: 100,
        error: null,
        lastCheckedAt: Date.now()
      }
    })
    window.oxe.app.getUpdateState = vi.fn().mockResolvedValue(useUpdaterStore.getState().app)

    render(<AppUpdateIndicator />)

    await user.click(screen.getByRole('button', { name: /OXESpace update ready/i }))
    expect(screen.getByText(/OXESpace 0\.2\.11/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Restart and install/i }))
    expect(window.oxe.app.quitAndInstall).toHaveBeenCalled()
  })

  test('offers the published release for manual Linux and development installs', async () => {
    const user = userEvent.setup()
    useUpdaterStore.setState({ app: { status: 'available', installMode: 'manual', currentVersion: '0.2.10', availableVersion: '0.2.11', progress: null, error: null, lastCheckedAt: Date.now() } })
    render(<AppUpdateIndicator />)
    await user.click(screen.getByRole('button', { name: /OXESpace update 0\.2\.11 available/i }))
    expect(screen.getByRole('link', { name: /Open releases/i })).toHaveAttribute('href', 'https://github.com/propagno/oxespace/releases/latest')
    expect(screen.queryByRole('button', { name: /Restart and install/i })).not.toBeInTheDocument()
  })

  test('keeps an RTK update in the titlebar and opens its action on demand', async () => {
    const user = userEvent.setup()
    useUpdaterStore.setState({
      rtk: {
        installed: true,
        version: '1.0.0',
        latestVersion: '1.1.0',
        updateAvailable: true,
        binDir: '/tmp/bin',
        error: null,
        checking: false,
        updating: false,
        lastCheckedAt: Date.now()
      }
    })
    window.oxe.rtk.getStatus = vi.fn().mockResolvedValue(useUpdaterStore.getState().rtk)
    window.oxe.rtk.checkForUpdate = vi.fn().mockResolvedValue(useUpdaterStore.getState().rtk)

    render(<UpdateBanner />)

    const trigger = await screen.findByRole('button', { name: 'RTK update 1.1.0 available' })
    expect(screen.queryByRole('dialog', { name: 'RTK update' })).not.toBeInTheDocument()
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'RTK update' })).toHaveTextContent('Installed 1.0.0')
    expect(screen.getByRole('button', { name: 'Update RTK' })).toBeVisible()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'RTK update' })).not.toBeInTheDocument()
  })
})
