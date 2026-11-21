import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SettingsContent } from '../../../src/components/Settings/SettingsModal'
import { useUpdaterStore } from '../../../src/store/updater.store'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useUpdaterStore.setState({
    app: {
      supported: true,
      currentVersion: '1.5.2',
      status: 'idle',
      progress: null,
      latestVersion: null,
      releaseNotes: null,
      error: null,
      preferences: null
    } as never
  })
})

describe('OXE-240 · PS-08.13 About download progress uses Meter without gradient', () => {
  test('a running download in About is a Meter with updates.downloadingLabel, app.progress and the percent', async () => {
    useUpdaterStore.setState({
      app: {
        supported: true,
        currentVersion: '1.5.2',
        status: 'downloading',
        progress: 42,
        latestVersion: '1.5.3',
        releaseNotes: null,
        error: null,
        preferences: null
      } as never
    })

    render(
      <SettingsContent
        section="about"
        agentProfiles={[]}
        agentReadiness={[]}
        isDiscoveringAgents={false}
        onClose={vi.fn()}
        onDiscoverAgents={vi.fn()}
        onConfigureAgent={vi.fn()}
        onNewCustomAgent={vi.fn()}
      />
    )

    const meter = await screen.findByRole('meter', { name: 'Downloading OXESpace update' })
    expect(meter).toHaveAttribute('aria-valuenow', '42')
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  test('About has no settings-progress-bar and no gradient', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'src/components/Settings/SettingsModal.tsx'), 'utf8')
    expect(tsx).not.toContain('settings-progress-bar')

    const css = readFileSync(resolve(process.cwd(), 'src/styles/components.css'), 'utf8')
    expect(css).not.toContain('.settings-progress-bar')
    expect(css).not.toMatch(/\.settings-progress\s*\{/)
  })
})
