import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { UpdateBanner } from '../../src/components/Updates/UpdateBanner'
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
      expect(screen.queryByTestId('update-banners')).not.toBeInTheDocument()
    })
  })

  test('shows restart CTA when app update downloaded', async () => {
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

    render(<UpdateBanner />)

    await waitFor(() => {
      expect(screen.getByText(/0\.2\.11 ready/i)).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /Restart now/i }))
    expect(window.oxe.app.quitAndInstall).toHaveBeenCalled()
  })

  test('shows RTK update banner when sidecar is stale', async () => {
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

    await waitFor(() => {
      expect(screen.getByTestId('rtk-update-banner')).toBeInTheDocument()
      expect(screen.getByText(/RTK 1\.1\.0 available/i)).toBeInTheDocument()
    })
  })
})
