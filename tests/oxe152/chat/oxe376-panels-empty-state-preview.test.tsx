// @vitest-environment jsdom
// Verification tests for Jira OXE-376:
// 1. All OxeChat panels (terminal, changes, browser/preview, session, git, files, search, background,
//    httpCalls/network, containers, queries) are reachable via chat header toggles + More panels menu
//    without ever hiding the composer, and without tab row / "+ Tool".
// 2. Empty state (.thread-opening & .thread-welcome) uses safe margin: auto vertical centering inside
//    a scrollable flex column (no justify-content: center top clipping at 960x720).
// 3. Narrow Web Preview browserbar & agent-access strip at 320px / 960x720 split: Go hides <= 340px
//    leaving ample room for URL bar, and External stays on a single row without wrapping.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadView } from '../../../src/components/Threads/ThreadView'
import { THREAD_BAR_PANELS, THREAD_MENU_PANELS, WORKBENCH_PANELS, type WorkbenchPanelId } from '../../../src/components/Workbench/panelCatalog'
import { changeLanguage, i18n } from '../../../src/i18n'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useThreadWorkbenchStore, type ThreadPanel } from '../../../src/store/thread-workbench.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import type { ThreadApi, ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'

vi.mock('../../../src/hooks/useGitBranch', () => ({
  useGitBranch: () => ({ branch: 'feat/oxe-376', detached: false, shortSha: null, error: null })
}))

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const tt = (key: string): string => i18n.t(key, { ns: 'thread' })
const tcode = (key: string): string => i18n.t(key, { ns: 'code' })

const EXPECTED_MENU_TO_THREAD_PANEL: ReadonlyArray<readonly [WorkbenchPanelId, ThreadPanel]> = [
  ['git', 'git'],
  ['files', 'files'],
  ['search', 'search'],
  ['background', 'background'],
  ['httpCalls', 'network'],
  ['containers', 'containers'],
  ['queries', 'queries']
]

const EXPECTED_BAR_TO_THREAD_PANEL: ReadonlyArray<readonly [WorkbenchPanelId, ThreadPanel]> = [
  ['terminal', 'terminal'],
  ['changes', 'changes'],
  ['browser', 'preview'],
  ['session', 'session']
]

function mountThread(toolTabs: Array<{ tab: string; count: number | null }> = [{ tab: 'conversation', count: null }]) {
  const snapshot: ThreadSnapshot = {
    thread: {
      id: 'thread-376',
      workspaceId: 'ws-376',
      projectId: 'proj-376',
      rootPath: '/repo',
      provider: 'claude',
      title: 'OXE-376 chat panels',
      pinned: false,
      status: 'idle',
      nativeSessionId: 'native-376',
      createdAt: 1,
      updatedAt: 1
    },
    events: []
  }
  const api = {
    commands: vi.fn(async () => ({ commands: [] })),
    projects: vi.fn(async () => ({ projects: [], unavailable: [] })),
    list: vi.fn(async () => [snapshot.thread]),
    read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [] })),
    configure: vi.fn(async () => snapshot),
    send: vi.fn(async () => {}),
    interrupt: vi.fn(async () => {}),
    pin: vi.fn(async () => {}),
    onChanged: vi.fn(() => () => {}),
    places: vi.fn(async () => ({ places: [], capped: false, refused: 0 })),
    onPlacesChanged: vi.fn(() => () => {}),
    toolTabs: vi.fn(async () => toolTabs)
  } as unknown as ThreadApi
  Object.defineProperty(window, 'oxe', {
    configurable: true,
    value: {
      thread: api,
      clipboard: { writeText: vi.fn(async () => true) },
      agentAccount: {
        read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 }))
      },
      search: {
        query: vi.fn(async () => ({ matches: [], truncated: false })),
        cancel: vi.fn(async () => undefined)
      },
      background: {
        list: vi.fn(async () => []),
        onEvent: vi.fn(() => () => undefined)
      },
      httpCalls: {
        list: vi.fn(async () => []),
        onChanged: vi.fn(() => () => undefined)
      },
      containers: {
        list: vi.fn(async () => ({ containers: [], runtime: null })),
        onChanged: vi.fn(() => () => undefined)
      },
      activity: {
        list: vi.fn(async () => []),
        onChanged: vi.fn(() => () => undefined)
      },
      fs: {
        listTree: vi.fn(async () => []),
        readFile: vi.fn(async () => '')
      },
      featureUsage: {
        record: vi.fn(async () => undefined)
      }
    }
  })
  const workspace = { id: 'ws-376', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({
    threads: [snapshot.thread],
    projects: [{ projectId: 'proj-376', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }],
    snapshot,
    selectedId: snapshot.thread.id,
    secondaryId: null
  } as never)
  useThreadWorkbenchStore.setState({ views: {}, maximizedId: null })
  return render(<ThreadView workspace={workspace} />)
}

function containerBlock(css: string, px: number): string {
  const start = css.search(new RegExp(`@container\\s+web-preview\\s*\\(\\s*max-width:\\s*${px}px\\s*\\)\\s*\\{`))
  expect(start, `@container web-preview (max-width: ${px}px)`).toBeGreaterThan(-1)
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index++) {
    if (css[index] === '{') depth++
    if (css[index] === '}' && --depth === 0) return css.slice(start, index + 1)
  }
  throw new Error('unclosed @container block')
}

beforeEach(() => { localStorage.clear() })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-376 · OxeChat panels, 960x720 empty state, and narrow Web Preview chrome', () => {
  it.each(['en', 'pt-BR'] as const)('exposes all 10+1 OxeChat panels (%s) via header toggles and More panels without hiding the composer', async locale => {
    await changeLanguage(locale)
    const user = userEvent.setup()
    mountThread([
      { tab: 'conversation', count: null },
      { tab: 'queries', count: 2 },
      { tab: 'containers', count: 1 }
    ])

    const header = document.querySelector<HTMLElement>('[data-ui="chat-header"]')!
    expect(header).not.toBeNull()
    expect(document.querySelectorAll('[role="tablist"], [data-ui="tabs"]')).toHaveLength(0)

    const composer = (): HTMLElement => screen.getByRole('textbox', { name: tt('composer.message') })
    expect(composer()).toBeInTheDocument()

    // 1. All four header toggles open their panel and keep the composer mounted & visible.
    const toggles = [...header.querySelectorAll<HTMLElement>('[data-ui="panel-toggle"]')]
    expect(toggles).toHaveLength(THREAD_BAR_PANELS.length)
    for (const [id, expectedPanel] of EXPECTED_BAR_TO_THREAD_PANEL) {
      const btn = toggles[THREAD_BAR_PANELS.indexOf(id)]
      fireEvent.click(btn)
      expect(useThreadWorkbenchStore.getState().views['thread-376']?.panel).toBe(expectedPanel)
      expect(composer()).toBeInTheDocument()
      expect(composer()).toBeVisible()
    }

    // 2. All seven More panels entries (git, files, search, background, httpCalls/network, containers, queries)
    //    are present with zero duplicates (even when toolTabs also reports queries & containers) and keep the composer visible.
    const moreTrigger = within(header).getByRole('button', { name: tcode('panels.more') })
    await user.click(moreTrigger)
    const menu = await screen.findByRole('menu')
    const items = within(menu).getAllByRole('menuitemcheckbox')
    expect(items).toHaveLength(THREAD_MENU_PANELS.length)

    for (const [id, expectedPanel] of EXPECTED_MENU_TO_THREAD_PANEL) {
      const currentMenu = await screen.findByRole('menu')
      const label = WORKBENCH_PANELS[id].label
      const matching = within(currentMenu).getAllByRole('menuitemcheckbox', { name: label })
      expect(matching, `exactly one menu item for ${id}`).toHaveLength(1)
      await user.click(matching[0])
      expect(useThreadWorkbenchStore.getState().views['thread-376']?.panel).toBe(expectedPanel)
      expect(composer()).toBeInTheDocument()
      expect(composer()).toBeVisible()
      // Reopen menu for the next panel check
      if (id !== EXPECTED_MENU_TO_THREAD_PANEL[EXPECTED_MENU_TO_THREAD_PANEL.length - 1][0]) {
        await user.click(moreTrigger)
      }
    }
  })

  it('centers empty states safely with margin: auto inside a scrollable flex column so 960x720 never clips the top', () => {
    const css = read('src/components/Threads/ThreadView.css')

    // Scrollable flex column + full-height reading column when empty state is rendered
    expect(css).toMatch(/\.thread-timeline:has\(>\s*\.thread-reading-column\s*>\s*\.thread-opening\)/)
    expect(css).toMatch(/\.thread-timeline:has\(>\s*\.thread-reading-column\s*>\s*\.thread-welcome\)/)
    expect(css).toMatch(/\.thread-reading-column:has\(>\s*\.thread-opening\),\s*\n\.thread-reading-column:has\(>\s*\.thread-welcome\)\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*flex:\s*1 0 auto[^}]*min-height:\s*100%/)

    // .thread-opening uses safe margin: auto (not fixed 48px top margin)
    const openingRule = css.match(/\.thread-opening\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(openingRule).toContain('margin: auto')
    expect(openingRule).not.toMatch(/justify-content:\s*center/)

    // .thread-welcome drops justify-content: center and calc(100cqh - 96px) in favor of safe margin: auto
    const welcomeRule = css.match(/\.thread-welcome\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(welcomeRule).toContain('margin: auto')
    expect(welcomeRule).not.toMatch(/justify-content:\s*center/)
    expect(welcomeRule).not.toContain('100cqh')
  })

  it('keeps Web Preview browserbar and External toggle single-row at 320px / 960x720 split without squeezing the URL bar', () => {
    const css = read('src/styles/scripts-webpreview.css')
    const tokens = read('src/styles/tokens.generated.css')

    // Browserbar keeps Go hidden <= 340px and Design hidden <= 380px so URL input never gets squeezed at 320px
    const narrow340 = containerBlock(css, 340)
    expect(narrow340).toMatch(/\.web-preview-go-button\s*\{[^}]*display:\s*none/)
    expect(narrow340).toMatch(/\.web-preview-address-input\s*\{[^}]*min-width:\s*96px/)

    const narrow380 = containerBlock(css, 380)
    expect(narrow380).toMatch(/\.web-preview-design-toggle\s*\{[^}]*display:\s*none/)

    // At 320px panel width (REVIEW_MIN_WIDTH), address input gets >= 176px even in comfortable density (28px buttons)
    const maxControl = Math.max(...[...tokens.matchAll(/--control-sm:\s*(\d+)px/g)].map(m => Number(m[1])))
    const space1 = Number(tokens.match(/--space-1:\s*(\d+)px/)?.[1])
    const space2 = Number(tokens.match(/--space-2:\s*(\d+)px/)?.[1])
    const fixedChrome = maxControl * 4 + space1 * 4 + space2 * 2 // Back, Forward, Reload, More + 4 gaps + 2 paddings
    expect(320 - fixedChrome).toBeGreaterThanOrEqual(176)

    // Agent access strip stays single-row (flex-wrap: nowrap) and hides the descriptive status span <= 440px
    // (after the base rule so the container query wins the cascade) so External never wraps onto a second line.
    const accessRule = css.match(/^\.web-preview-agent-access\s*\{([^}]+)\}/m)?.[1] ?? ''
    expect(accessRule).toMatch(/flex-wrap:\s*nowrap/)
    expect(accessRule).toMatch(/min-width:\s*0/)

    const accessIndex = css.search(/^\.web-preview-agent-access\s*\{/m)
    const narrow440Index = css.search(/@container\s+web-preview\s*\(\s*max-width:\s*440px\s*\)\s*\{/)
    expect(narrow440Index).toBeGreaterThan(accessIndex)

    const narrow440 = containerBlock(css, 440)
    expect(narrow440).toMatch(/\.web-preview-agent-access\s*>\s*span\s*\{[^}]*display:\s*none/)

    const toggleRule = css.match(/\.web-preview-external-toggle\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(toggleRule).toMatch(/flex-shrink:\s*0/)
    expect(toggleRule).toMatch(/white-space:\s*nowrap/)
  })
})
