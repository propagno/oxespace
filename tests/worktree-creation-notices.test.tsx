import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MainMessage } from '../shared/messages'
import { changeLanguage } from '../src/i18n'
import { WorktreeCreationNotices, worktreeNoticeIntent, worktreeNoticesIntent } from '../src/components/Worktree/WorktreeCreationNotices'

/** CCR (B19 FINDING L): createWorktree's C3 notices are worded by the window, where the worktree is created. */

const created: MainMessage = { code: 'worktree.createdFrom', params: { path: '/repo-wt', branch: 'feature/x', base: 'origin/main' } }
const copied: MainMessage = { code: 'worktree.copyFiles.copied', params: { count: 2 } }
const refused: MainMessage = { code: 'worktree.copyFiles.outsideRepo', params: { patterns: ['../secret'] } }
const hooks: MainMessage = { code: 'git.hooks.skipped', params: {} }

afterEach(async () => { cleanup(); await act(async () => { await changeLanguage('en') }) })

describe('the weight of what creating a worktree reported', () => {
  it('done, info, or something to act on; the block takes the heaviest', () => {
    expect(worktreeNoticeIntent(created)).toBe('success')
    expect(worktreeNoticeIntent(copied)).toBe('success')
    expect(worktreeNoticeIntent(hooks)).toBe('info')
    expect(worktreeNoticeIntent(refused)).toBe('warning')
    expect(worktreeNoticeIntent({ code: 'worktree.setup.failed', params: { exitCode: 3 } })).toBe('warning')
    expect(worktreeNoticesIntent([created, copied])).toBe('success')
    expect(worktreeNoticesIntent([created, hooks, refused])).toBe('warning')
  })
})

describe('WorktreeCreationNotices', () => {
  it('words the creation as its title and each later notice in the interface language; dismissible', async () => {
    const onDismiss = vi.fn()
    const { rerender } = render(<WorktreeCreationNotices notices={[created, copied, refused]} onDismiss={onDismiss} />)
    expect(screen.getByText('Worktree created at /repo-wt (branch feature/x from origin/main).')).toBeTruthy()
    expect(screen.getByText('Copied 2 files listed in worktree.copyFiles.')).toBeTruthy()
    expect(screen.getByText(/\.\.\/secret/)).toBeTruthy()
    // A refusal among them: announced at once.
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)

    await act(async () => { await changeLanguage('pt-BR') })
    rerender(<WorktreeCreationNotices notices={[created, copied]} onDismiss={onDismiss} />)
    expect(screen.getByText('Worktree criado em /repo-wt (branch feature/x a partir de origin/main).')).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
  })

  it('the creation is the title by its code, even when another notice comes first', () => {
    const stale: MainMessage = { code: 'git.base.maybeStale', params: { branch: 'origin/main' } }
    render(<WorktreeCreationNotices notices={[stale, created]} onDismiss={() => {}} />)
    expect(screen.getByText('Worktree created at /repo-wt (branch feature/x from origin/main).').tagName).toBe('STRONG')
    expect(screen.getByTestId('worktree-creation-notices').textContent).toContain('origin/main')
  })

  it('shows nothing without notices', () => {
    const { container } = render(<WorktreeCreationNotices notices={[]} onDismiss={() => {}} />)
    expect(container.innerHTML).toBe('')
  })
})
