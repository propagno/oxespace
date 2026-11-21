// Acceptance test for 1.5.2 Polimento · Primeiro uso / GitHub (Jira OXE-211, PU-03·8, CA-1 and CA-2).
// Contract:
// - CA-1: copying "gh auth login" from GitHubCliSetup, GitHub SettingsTab, and Settings › Integrations › GitHub
//   calls copyText('gh auth login', ...) and shows a success confirmation toast.
// - CA-2: when both native and browser clipboards fail, copyText emits an error toast (intent: 'danger'), never silence.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GitHubCliSetup, SettingsTab } from '../../../src/components/GitHub/GitHubPanel'
import { GitHubIntegrationSettings } from '../../../src/components/Settings/GitHubIntegrationSettings'
import { Toaster } from '../../../src/ui'
import type { GitHubCliStatus, GitHubWorkspaceStatus } from '../../../shared/types/github'

const DISCONNECTED_CLI: GitHubCliStatus = {
  available: true,
  authenticated: false,
  user: null,
  host: null,
  message: null
}

const DISCONNECTED_WORKSPACE_STATUS: GitHubWorkspaceStatus = {
  cli: DISCONNECTED_CLI,
  repo: null,
  isGitRepo: true,
  rootPath: 'C:/repos/atlas',
  branch: 'main',
  upstream: null,
  ahead: 0,
  behind: 0,
  dirty: false,
  staged: 0,
  modified: 0,
  untracked: 0,
  conflicted: 0,
  lastCommit: null
} as unknown as GitHubWorkspaceStatus

let nativeWriteText: ReturnType<typeof vi.fn>
let webWriteText: ReturnType<typeof vi.fn>

beforeEach(() => {
  nativeWriteText = vi.fn(async () => true)
  webWriteText = vi.fn(async () => undefined)
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      clipboard: { writeText: nativeWriteText },
      github: { getCliStatus: vi.fn(async () => DISCONNECTED_CLI) }
    }
  })
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: webWriteText }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OXE-211 · PU-03·8 copy "gh auth login" with copyText and toast', () => {
  test('copying gh auth login calls copyText and shows confirmation toast in GitHub panel and Integrations settings', async () => {
    // 1. GitHubCliSetup (disconnected GitHub panel)
    render(
      <>
        <Toaster />
        <GitHubCliSetup cli={DISCONNECTED_CLI} onRunCommand={vi.fn()} />
      </>
    )
    const cliCopyBtn = screen.getByRole('button', { name: /copy.*gh auth login/i })
    fireEvent.click(cliCopyBtn)
    await waitFor(() => expect(nativeWriteText).toHaveBeenCalledWith('gh auth login'))
    await waitFor(() => expect(document.body.textContent).toMatch(/Command copied/i))
    cleanup()

    // 2. GitHub SettingsTab (disconnected state)
    nativeWriteText.mockClear()
    render(
      <>
        <Toaster />
        <SettingsTab
          status={DISCONNECTED_WORKSPACE_STATUS}
          rootPath="C:/repos/atlas"
          connectedRepositories={[]}
          onRunCommand={vi.fn()}
          onRefresh={vi.fn()}
        />
      </>
    )
    const tabCopyBtn = screen.getByRole('button', { name: /copy.*gh auth login/i })
    fireEvent.click(tabCopyBtn)
    await waitFor(() => expect(nativeWriteText).toHaveBeenCalledWith('gh auth login'))
    await waitFor(() => expect(document.body.textContent).toMatch(/Command copied/i))
    cleanup()

    // 3. Settings › Integrations › GitHub
    nativeWriteText.mockClear()
    render(
      <>
        <Toaster />
        <GitHubIntegrationSettings />
      </>
    )
    const settingsCopyBtn = await screen.findByRole('button', { name: /copy.*gh auth login/i })
    fireEvent.click(settingsCopyBtn)
    await waitFor(() => expect(nativeWriteText).toHaveBeenCalledWith('gh auth login'))
    await waitFor(() => expect(document.body.textContent).toMatch(/Command copied/i))
  })

  test('clipboard failure shows copyText error toast instead of failing silently', async () => {
    nativeWriteText.mockRejectedValue(new Error('native clipboard blocked'))
    webWriteText.mockRejectedValue(new Error('browser clipboard blocked'))

    render(
      <>
        <Toaster />
        <GitHubIntegrationSettings />
      </>
    )

    const copyBtn = await screen.findByRole('button', { name: /copy.*gh auth login/i })
    fireEvent.click(copyBtn)

    await waitFor(() => expect(nativeWriteText).toHaveBeenCalledWith('gh auth login'))
    await waitFor(() => expect(webWriteText).toHaveBeenCalledWith('gh auth login'))
    await waitFor(() => expect(document.body.textContent).toMatch(/Could not copy/i))
  })
})
