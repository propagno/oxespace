import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitControlStatus } from '../shared/types/git'
import { GitControlPanel } from '../src/components/GitHub/GitControlPanel'

afterEach(() => vi.restoreAllMocks())

describe('Git control presentation', () => {
  it('keeps a clean working tree free of staging and commit forms', async () => {
    const status: GitControlStatus = { branch: 'main', ahead: 0, behind: 0, files: [], checkedAt: Date.now() }
    window.oxe = { git: { getStatus: vi.fn().mockResolvedValue(status) } } as unknown as typeof window.oxe
    render(<GitControlPanel workspaceId="workspace" rootPath="C:\\repo" />)
    expect(await screen.findByText('Working tree clean')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Stage all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Commit message' })).not.toBeInTheDocument()
    expect(screen.getByText(/Remote actions/)).toBeVisible()
    expect(screen.getByText('Upstream not set')).toBeVisible()
  })

  it('reveals commit controls when changes are staged', async () => {
    const status: GitControlStatus = { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, files: [{ path: 'src/App.tsx', staged: true, unstaged: false, untracked: false, conflicted: false, status: 'M.' }], checkedAt: Date.now() }
    window.oxe = { git: { getStatus: vi.fn().mockResolvedValue(status) } } as unknown as typeof window.oxe
    render(<GitControlPanel workspaceId="workspace" rootPath="C:\\repo" />)
    expect(await screen.findByRole('textbox', { name: 'Commit message' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Commit 1 staged' })).toBeDisabled()
    expect(screen.getByText('origin/main')).toBeVisible()
  })

  it('keeps unresolved conflicts out of staged changes and commit actions', async () => {
    const status: GitControlStatus = { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, files: [{ path: 'src/conflict.ts', staged: true, unstaged: true, untracked: false, conflicted: true, status: 'UU' }], checkedAt: Date.now() }
    window.oxe = { git: { getStatus: vi.fn().mockResolvedValue(status) } } as unknown as typeof window.oxe
    render(<GitControlPanel workspaceId="workspace" rootPath="C:\\repo" />)
    expect(await screen.findByText('Conflicts')).toBeVisible()
    expect(screen.getByText(/Resolve conflicts in the editor/)).toBeVisible()
    expect(screen.queryByText('Staged')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Commit message' })).not.toBeInTheDocument()
  })
})
