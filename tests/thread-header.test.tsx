import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ConversationThread } from '../shared/types/thread'
import type { Workspace } from '../shared/types/workspace'
import { ThreadHeader } from '../src/components/Threads/ThreadHeader'

const thread = {
  id: 't1', provider: 'claude', title: 'Fix login', pinned: false, status: 'idle', rootPath: String.raw`C:\work\app`,
  observedLocation: { cwd: String.raw`C:\work\app-wt\src`, checkoutRoot: String.raw`C:\work\app-wt`, sameRepository: true }
} as unknown as ConversationThread
const workspace = { id: 'w1', name: 'app', rootPath: String.raw`C:\work\app` } as unknown as Workspace
const noop = () => undefined

function renderHeader(props: Partial<Parameters<typeof ThreadHeader>[0]> = {}) {
  return render(<ThreadHeader thread={thread} workspace={workspace} branch="feature/login" pending={false} running={false}
    onTogglePanel={noop} onCommand={noop} onDelegate={noop} onPin={noop} {...props} />)
}

describe('Thread header context', () => {
  it('names the branch and the worktree badge for assistive technology and in their tooltips', () => {
    const { container } = renderHeader()
    const branch = container.querySelector('.thread-heading-branch') as HTMLElement
    const worktree = container.querySelector('.thread-heading-worktree') as HTMLElement
    expect(branch).toHaveAccessibleName('Branch: feature/login')
    expect(branch).toHaveAttribute('title', 'Branch: feature/login')
    expect(worktree).toHaveAccessibleName(/The agent is working in C:\\work\\app-wt/)
    expect(worktree.getAttribute('title')).toContain(String.raw`C:\work\app-wt`)
    // The visible words stay in the DOM (only visually hidden in a narrow header), never aria-hidden.
    expect(branch).toHaveTextContent('feature/login')
    expect(worktree).toHaveTextContent('worktree')
    for (const element of [branch, worktree]) expect(element.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('shows no worktree badge while the agent works in the conversation folder', () => {
    const { container } = renderHeader({ thread: { ...thread, observedLocation: undefined } as ConversationThread })
    expect(container.querySelector('.thread-heading-worktree')).toBeNull()
    expect(container.querySelector('.thread-heading-branch')).toHaveAccessibleName('Branch: feature/login')
  })

  it('a narrow heading compacts the context instead of hiding it (the PR #151 regression)', () => {
    const css = ['ThreadView.css', 'ThreadHeaderChrome.css']
      .map(name => readFileSync(join(__dirname, '..', 'src', 'components', 'Threads', name), 'utf8')).join('\n')
    expect(css).not.toMatch(/\.thread-heading-(?:context|branch|worktree|label)\s*\{[^}]*display:\s*none/)
    const compact = css.match(/@container thread-heading \(max-width: 720px\) \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(compact).toMatch(/\.thread-heading-label \{[^}]*clip-path: inset\(50%\)/)
  })
})
