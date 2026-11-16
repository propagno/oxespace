// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (OXE program oxespace-152-code, phase F6, Jira OXE-182, AG-04a).
// Written by the planner; the executor must not edit it. Source: the card OXE-182 (CA-1, CA-2, RN-1, RT-2) from the
// Antigravity proposal AG-04 item 2a, approved by MARCA for 1.5.2; the user's rule of 15/11 ("o backend deve acompanhar":
// the folder name is main's data already, src/utils/workspaceScope.ts › resolveWorkspaceScope → scope.folderName).
// Today (main 66e0080d5) PanelScopeBadge labels itself with gitBranchLabel(branch), so a folder without git reads
// "Branch unavailable" / "Branch indisponível".
// Contract: the badge ([data-testid=panel-scope-badge]) says what the panel reads: the branch when git knows it (as today),
// scope.folderName when the folder has no git (useGitBranch reports no branch and no sha); never code:paneMenu.noBranch.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PanelScopeBadge } from '../../../src/components/Workspace/PanelScopeBadge'
import { changeLanguage, i18n } from '../../../src/i18n'

const mocks = vi.hoisted(() => ({ status: null as null | { branch: string | null; detached: boolean; shortSha: string | null; error: string | null } }))
vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => mocks.status }))

const scope = { rootPath: '/tmp/plain-folder', isWorktree: false, folderName: 'plain-folder', paneId: null, pinned: false }
const badge = (): HTMLElement => screen.getByTestId('panel-scope-badge')

afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-182 AG-04a the scope badge names the folder without git (A35)', () => {
  it.each(['en', 'pt-BR'])('a folder without git (%s) shows its name, never "Branch unavailable"', async locale => {
    await changeLanguage(locale)
    mocks.status = { branch: null, detached: false, shortSha: null, error: 'not a git repository' }
    render(<PanelScopeBadge workspaceId="ws" scope={scope as never} />)
    expect(badge()).toHaveTextContent('plain-folder')
    expect(badge().textContent ?? '').not.toContain(i18n.t('paneMenu.noBranch', { ns: 'code' }) as string)
    expect(badge().textContent ?? '').not.toMatch(/branch unavailable|branch indispon/i)
  })

  it('a repository with a known branch still shows the branch', () => {
    mocks.status = { branch: 'feat/pix-webhook', detached: false, shortSha: null, error: null }
    render(<PanelScopeBadge workspaceId="ws" scope={{ ...scope, rootPath: '/repo', folderName: 'repo' } as never} />)
    expect(badge()).toHaveTextContent('feat/pix-webhook')
  })
})
