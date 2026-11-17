// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (OXE program oxespace-152-code, phase F6, Jira OXE-184, AG-04c).
// Written by the planner; the executor must not edit it. Source: the card OXE-184 (CA-1 to CA-3, RN-1, RT-3: the pt-BR copy
// "Fixar o escopo" / "Seguir o painel ativo"; en "Pin the scope" / "Follow the active pane", proposed, the brand reviews it)
// from AG-04 item 2d, approved by MARCA. UI only: the pinned state is the ui store's (src/store/ui.store.ts ›
// panelScopePinnedByWorkspace, a pinned path after OXE-183).
// Today (main 66e0080d5) the badge is a toggle with no state for assistive technology and no name saying what it does.
// Contract: the scope badge button carries aria-pressed ("false" following the active pane, "true" pinned) and an
// accessible name that says what a press does: unpinned "Pin the scope" / "Fixar o escopo", pinned "Follow the active
// pane" / "Seguir o painel ativo" (the folder or branch stays visible text and the title keeps the detail); the pin icon
// shows when pinned; Space and Enter toggle it and aria-pressed follows.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelScopeBadge } from '../../../src/components/Workspace/PanelScopeBadge'
import { useUIStore } from '../../../src/store/ui.store'
import { changeLanguage } from '../../../src/i18n'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))

const scope = { rootPath: '/repo', isWorktree: false, folderName: 'repo', paneId: null, pinned: false }
const NAMES = { en: ['Pin the scope', 'Follow the active pane'], 'pt-BR': ['Fixar o escopo', 'Seguir o painel ativo'] } as const
const badge = (): HTMLElement => screen.getByTestId('panel-scope-badge')

beforeEach(() => { useUIStore.setState({ panelScopePinnedByWorkspace: {} } as never) })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-184 AG-04c the pin says its state and what it does (A37)', () => {
  it.each(['en', 'pt-BR'] as const)('unpinned (%s): aria-pressed false, named for pinning; pinned: aria-pressed true, named for following, with the pin icon', async locale => {
    await changeLanguage(locale)
    render(<PanelScopeBadge workspaceId="ws" scope={scope as never} />)
    expect(badge()).toHaveAttribute('aria-pressed', 'false')
    expect(badge()).toHaveAccessibleName(NAMES[locale][0])
    await userEvent.click(badge())
    expect(badge()).toHaveAttribute('aria-pressed', 'true')
    expect(badge()).toHaveAccessibleName(NAMES[locale][1])
    expect(badge().querySelectorAll('svg').length, 'the pin icon').toBeGreaterThan(0)
  })

  it('Space and Enter toggle it, and aria-pressed follows', async () => {
    render(<PanelScopeBadge workspaceId="ws" scope={scope as never} />)
    badge().focus()
    await userEvent.keyboard(' ')
    expect(badge()).toHaveAttribute('aria-pressed', 'true')
    await userEvent.keyboard('{Enter}')
    expect(badge()).toHaveAttribute('aria-pressed', 'false')
  })
})
