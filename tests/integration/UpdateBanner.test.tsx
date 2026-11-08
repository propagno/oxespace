import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AppUpdateIndicator } from '../../src/components/Updates/AppUpdateIndicator'
import { useUpdaterStore } from '../../src/store/updater.store'

describe('AppUpdateIndicator', () => {
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
      dismissedVersion: null
    })

    window.oxe = {
      app: {
        version: '0.2.10',
        getUpdateState: vi.fn().mockResolvedValue(useUpdaterStore.getState().app),
        checkForUpdates: vi.fn(),
        quitAndInstall: vi.fn().mockResolvedValue(true),
        onUpdateState: vi.fn(() => () => undefined)
      }
    } as unknown as typeof window.oxe
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
})
