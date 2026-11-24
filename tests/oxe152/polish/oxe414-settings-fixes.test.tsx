import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PolicySettings } from '../../../src/components/Settings/PolicySettings'
import { UpdatePreferences } from '../../../src/components/Settings/UpdatePreferences'
import { AgentPermissionsSettings } from '../../../src/components/Settings/AgentPermissionsSettings'
import { AgentActivityDetail } from '../../../src/components/Settings/AgentActivityDetail'
import { SettingsCenter } from '../../../src/components/Settings/SettingsCenter'
import { Dialog, ToolPanel } from '../../../src/ui'
import { useOpenInStore } from '../../../src/lib/openIn'
import { useUIStore, type SettingsPageId } from '../../../src/store/ui.store'

const originalOxe = window.oxe

beforeEach(() => {
  useOpenInStore.setState({ targets: null })
  useUIStore.setState({ isMcpPanelOpen: false })
})

afterEach(() => {
  cleanup()
  window.oxe = originalOxe
  useOpenInStore.setState({ targets: null })
  useUIStore.setState({ isMcpPanelOpen: false })
})

describe('OXE-414: Settings menu layering, child Escape, external editor & visual polish', () => {
  it('PolicySettings omits its h2 when hideHeading is true (no duplicate heading in Workspace › Policy)', () => {
    window.oxe = {
      ...originalOxe,
      policy: { get: vi.fn().mockResolvedValue({ locations: [], sources: [], problems: [] }) }
    } as unknown as typeof window.oxe

    const { rerender } = render(<PolicySettings workspaceId="ws-1" hideHeading />)
    expect(screen.getByTestId('policy-settings').querySelector('h2')).toBeNull()

    rerender(<PolicySettings workspaceId="ws-1" />)
    expect(screen.getByTestId('policy-settings').querySelector('h2')).not.toBeNull()
  })

  it('UpdatePreferences renders both switches inside aligned SettingRows and toggles cleanly', () => {
    const onChange = vi.fn()
    render(
      <UpdatePreferences
        preferences={{ mode: 'auto', pinnedVersion: null, channel: 'stable' }}
        currentVersion="1.5.2"
        onChange={onChange}
      />
    )
    const rows = document.querySelectorAll('.settings-update-preferences [data-ui="setting-row"]')
    expect(rows).toHaveLength(2)
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    fireEvent.click(switches[0])
    expect(onChange).toHaveBeenCalledWith({ mode: 'auto', pinnedVersion: '1.5.2', channel: 'stable' })
    fireEvent.click(switches[1])
    expect(onChange).toHaveBeenCalledWith({ mode: 'auto', pinnedVersion: null, channel: 'beta' })
  })

  it('AgentPermissionsSettings and AgentActivityDetail respect the configured external editor and never hardcode vscode', async () => {
    const permissionsSrc = readFileSync(join(process.cwd(), 'src/components/Settings/AgentPermissionsSettings.tsx'), 'utf8')
    const activitySrc = readFileSync(join(process.cwd(), 'src/components/Settings/AgentActivityDetail.tsx'), 'utf8')
    expect(permissionsSrc).not.toMatch(/target:\s*['"]vscode['"]/)
    expect(activitySrc).not.toMatch(/target:\s*['"]vscode['"]/)

    const openIn = vi.fn().mockResolvedValue(undefined)
    useOpenInStore.setState({
      targets: { editors: [{ id: 'cursor', name: 'Cursor' }], preferred: 'cursor' }
    })
    window.oxe = {
      ...originalOxe,
      app: { ...(originalOxe?.app ?? {}), openIn },
      policy: { get: vi.fn().mockResolvedValue({ sources: [{ path: '.oxe/policy.yaml' }], locations: [], problems: [] }) },
      agentPermissions: {
        list: vi.fn().mockResolvedValue({
          rules: [],
          databases: [],
          hosts: [],
          policy: [{ section: 'commands', text: 'deny rm -rf' }]
        })
      }
    } as unknown as typeof window.oxe

    render(<AgentPermissionsSettings workspaceId="ws-1" />)
    const openBtn = await screen.findByRole('button', { name: /open in editor|abrir no editor/i })
    fireEvent.click(openBtn)
    await waitFor(() => expect(openIn).toHaveBeenCalledWith(expect.objectContaining({ target: 'cursor', path: '.oxe/policy.yaml' })))

    cleanup()
    openIn.mockClear()
    window.oxe = {
      ...originalOxe,
      app: { ...(originalOxe?.app ?? {}), openIn },
      git: { getStatus: vi.fn().mockResolvedValue({ files: [{ path: 'src/index.ts' }] }) },
      agentActivity: { detail: vi.fn().mockResolvedValue({ path: 'src/index.ts', line: 42 }) }
    } as unknown as typeof window.oxe

    render(
      <AgentActivityDetail
        row={{ id: 'act-1', source: 'changes', workspaceId: 'ws-1', path: 'src/index.ts', summary: 'src/index.ts', line: 42 }}
        onClose={vi.fn()}
      />
    )
    const activityBtn = await screen.findByRole('button', { name: /open in editor|abrir no editor/i })
    fireEvent.click(activityBtn)
    await waitFor(() => expect(openIn).toHaveBeenCalledWith(expect.objectContaining({ target: 'cursor', path: 'src/index.ts', line: 42 })))
  })

  it('Escape closes only the child dialog (ToolPanel / Dialog) and does not dismiss SettingsCenter underneath', () => {
    const onSettingsClose = vi.fn()
    const onMcpClose = vi.fn(() => useUIStore.setState({ isMcpPanelOpen: false }))

    useUIStore.setState({ isMcpPanelOpen: true })
    const { rerender } = render(
      <>
        <SettingsCenter
          workspaces={[]}
          initialPage="general"
          shellProfiles={[]}
          allowWorkspaceScope={false}
          agentProfiles={[]}
          agentReadiness={[]}
          isDiscoveringAgents={false}
          onClose={onSettingsClose}
          onDiscoverAgents={vi.fn()}
          onConfigureAgent={vi.fn()}
          onNewCustomAgent={vi.fn()}
          onSave={vi.fn().mockResolvedValue(undefined)}
        />
        <ToolPanel label="MCP servers" onClose={onMcpClose}>
          <div>MCP content</div>
        </ToolPanel>
      </>
    )

    const mcpDialog = screen.getByRole('dialog', { name: 'MCP servers' })
    fireEvent.keyDown(mcpDialog, { key: 'Escape' })
    expect(onMcpClose).toHaveBeenCalledTimes(1)
    expect(onSettingsClose).not.toHaveBeenCalled()

    // Now test a sibling Radix Dialog (like AgentConfigModal) mounted after SettingsCenter
    const onChildDialogClose = vi.fn()
    useUIStore.setState({ isMcpPanelOpen: false })
    rerender(
      <>
        <SettingsCenter
          workspaces={[]}
          initialPage="general"
          shellProfiles={[]}
          allowWorkspaceScope={false}
          agentProfiles={[]}
          agentReadiness={[]}
          isDiscoveringAgents={false}
          onClose={onSettingsClose}
          onDiscoverAgents={vi.fn()}
          onConfigureAgent={vi.fn()}
          onNewCustomAgent={vi.fn()}
          onSave={vi.fn().mockResolvedValue(undefined)}
        />
        <Dialog title="Configure agent" size="md" onClose={onChildDialogClose}>
          <div>Agent form</div>
        </Dialog>
      </>
    )

    const agentDialog = screen.getByRole('dialog', { name: 'Configure agent' })
    fireEvent.keyDown(agentDialog, { key: 'Escape' })
    expect(onChildDialogClose).toHaveBeenCalledTimes(1)
    expect(onSettingsClose).not.toHaveBeenCalled()
  })

  it('App.tsx mounts McpPanelHost after SettingsCenter and SettingsPageId includes github', () => {
    const appSrc = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    const settingsIdx = appSrc.indexOf('<SettingsCenter')
    const mcpIdx = appSrc.indexOf('<McpPanelHost')
    expect(settingsIdx).toBeGreaterThan(-1)
    expect(mcpIdx).toBeGreaterThan(settingsIdx)

    const githubPage: SettingsPageId = 'github'
    expect(githubPage).toBe('github')
  })
})
