// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  composeMessageWithElements,
  formatDesignGrabs,
  previewElementLabel,
  type DesignGrabPayload,
  type PreviewElementRef
} from '../../shared/types/design-mode'
import type { BrowserPreviewEvent, BrowserPreviewSessionState } from '../../shared/types/browser-preview'
import type { ThreadApi, ThreadSnapshot } from '../../shared/types/thread'
import type { Workspace } from '../../shared/types/workspace'
import { changeLanguage } from '../../src/i18n'
import { CONTROL, TEXT } from '../../src/design/tokens/scales'
import { useAccountStore } from '../../src/store/account.store'
import { useThreadStore } from '../../src/store/thread.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'
import { ThreadView } from '../../src/components/Threads/ThreadView'
import { WebPreviewPanel } from '../../src/components/WebPreview/WebPreviewPanel'

vi.mock('../../src/hooks/useGitBranch', () => ({
  useGitBranch: () => ({ branch: 'feat/oxe-10', detached: false, shortSha: null, error: null })
}))

const SAMPLE_PAYLOAD: DesignGrabPayload = {
  tagName: 'button',
  selector: 'main > button.checkout-cta',
  text: 'Finalizar compra',
  html: '<button class="checkout-cta">Finalizar compra</button>',
  classes: ['checkout-cta'],
  styles: [],
  rect: { x: 10, y: 20, width: 140, height: 36 },
  pageUrl: 'http://127.0.0.1:4321/cart',
  pageTitle: 'Cart',
  capturedAt: '2026-11-20T00:00:00.000Z'
}

function makeElementRef(overrides?: Partial<PreviewElementRef>): PreviewElementRef {
  return {
    id: 'preview-el-1',
    label: previewElementLabel(SAMPLE_PAYLOAD),
    selector: SAMPLE_PAYLOAD.selector,
    prompt: formatDesignGrabs([{ payload: SAMPLE_PAYLOAD }], ''),
    ...overrides
  }
}

function setupThreadFixture() {
  const snapshot: ThreadSnapshot = {
    thread: {
      id: 'thread-oxe-10',
      workspaceId: 'ws-1',
      projectId: 'project-1',
      rootPath: '/repo',
      provider: 'claude',
      title: 'Web Preview chip test',
      pinned: false,
      status: 'idle',
      nativeSessionId: null,
      createdAt: 1,
      updatedAt: 1
    },
    events: []
  }
  const api: ThreadApi = {
    commands: vi.fn(async () => ({ commands: [] })),
    projects: vi.fn(async () => ({ projects: [], unavailable: [] })),
    addProject: vi.fn(async () => ({
      projectId: 'project-1',
      displayName: 'Repo',
      identityLabel: '/repo',
      hidden: false,
      contexts: [{ rootPath: '/repo', label: 'Repo' }]
    })),
    setProjectHidden: vi.fn(async () => {}),
    list: vi.fn(async () => [snapshot.thread]),
    create: vi.fn(async () => snapshot),
    read: vi.fn(async () => snapshot),
    models: vi.fn(async () => ({ defaultModel: 'native-model', models: [] })),
    configure: vi.fn(async () => snapshot),
    send: vi.fn(async () => {}),
    attach: vi.fn(async () => ({ id: 'att-1', name: 'element.png', mimeType: 'image/png', bytes: 12 })),
    interrupt: vi.fn(async () => {}),
    approve: vi.fn(async () => {}),
    pin: vi.fn(async () => {}),
    onChanged: vi.fn(() => () => {})
  }
  const workspace = { id: 'ws-1', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
  useAccountStore.setState({ scopes: {}, snapshots: {} })
  useWorkspaceStore.setState({ workspaces: [workspace] })
  useThreadStore.setState({
    threads: [snapshot.thread],
    projects: [{ projectId: 'project-1', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }],
    snapshot,
    selectedId: snapshot.thread.id,
    secondaryId: null,
    snapshotCache: {},
    snapshotCacheOrder: [],
    drafts: {},
    attachments: {},
    previewElements: {},
    errors: {},
    hiddenProjects: []
  })
  return { snapshot, api, workspace }
}

afterEach(async () => {
  cleanup()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.density
  await changeLanguage('en')
  vi.unstubAllGlobals()
})

describe('OXE-10 · Web Preview element chips in the composer', () => {
  it('renders selected Web Preview element as a structured chip with selector and label across themes and densities', async () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/Threads/PreviewElementChips.module.css'), 'utf8')
    expect(css).toContain('var(--control-sm)')
    expect(css).toContain('var(--fs-xs)')
    expect(css).toContain('var(--radius-full)')
    expect(css).toContain('var(--surface-sunken)')
    expect(css).toContain('var(--bd-subtle)')

    expect(CONTROL.compact.sm).toBe(24)
    expect(CONTROL.comfortable.sm).toBe(28)
    expect(TEXT.xs).toBe(12)

    const matrix: Array<{ theme: 'light' | 'dark'; density: 'compact' | 'comfortable'; lang: 'en' | 'pt-BR' }> = [
      { theme: 'light', density: 'compact', lang: 'en' },
      { theme: 'dark', density: 'compact', lang: 'pt-BR' },
      { theme: 'light', density: 'comfortable', lang: 'pt-BR' },
      { theme: 'dark', density: 'comfortable', lang: 'en' }
    ]

    for (const combo of matrix) {
      document.documentElement.dataset.theme = combo.theme
      document.documentElement.dataset.density = combo.density
      await changeLanguage(combo.lang)

      const { snapshot, api, workspace } = setupThreadFixture()
      let onPreviewEvent: ((event: BrowserPreviewEvent) => void) | null = null
      const sentToAgent = vi.fn((prompt: string, extra?: { images?: unknown[]; elements?: PreviewElementRef[] }) => {
        if (prompt.trim()) useThreadStore.getState().setDraft(snapshot.thread.id, prompt)
        for (const el of extra?.elements ?? []) useThreadStore.getState().addPreviewElement(snapshot.thread.id, el)
      })

      vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
      })
      if (!HTMLElement.prototype.checkVisibility) {
        Object.defineProperty(HTMLElement.prototype, 'checkVisibility', { configurable: true, value: () => true })
      }
      const previewOwnerKey = `thread:${snapshot.thread.id}`
      const previous = window.oxe
      Object.defineProperty(window, 'oxe', {
        configurable: true,
        value: {
          thread: api,
          fs: { readFile: vi.fn(async () => ({ content: '' })), listTree: vi.fn(async () => []) },
          terminal: { onData: vi.fn(() => () => {}), onExit: vi.fn(() => () => {}) },
          agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) },
          browserPreview: {
            session: vi.fn(async () => ({
              ownerKey: previewOwnerKey,
              activeTabId: 'tab-1',
              tabs: [{ id: 'tab-1', url: 'http://127.0.0.1:4321/cart', loading: false, error: null, canGoBack: false, canGoForward: false }]
            } as BrowserPreviewSessionState)),
            onEvent: vi.fn((listener: (event: BrowserPreviewEvent) => void) => {
              onPreviewEvent = listener
              return () => {}
            }),
            designMode: vi.fn(async () => ({ enabled: true })),
            setAccess: vi.fn(async () => ({ allowed: false })),
            mount: vi.fn(async () => ({ lease: 'lease-1' })),
            close: vi.fn(async () => {}),
            setZoom: vi.fn(async () => {}),
            bounds: vi.fn(async () => {}),
            capture: vi.fn(async () => ({
              dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              fileName: 'element-oxe10.png',
              path: 'C:/tmp/element-oxe10.png'
            })),
            captureElementFile: vi.fn(async () => ({
              dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              fileName: 'element-oxe10.png',
              path: 'C:/tmp/element-oxe10.png'
            }))
          }
        }
      })

      try {
        render(
          <>
            <WebPreviewPanel
              workspace={workspace}
              threadId={snapshot.thread.id}
              onRunCommand={() => {}}
              onClose={() => {}}
              onSendToAgent={sentToAgent}
            />
            <ThreadView workspace={workspace} />
          </>
        )

        await waitFor(() => expect(onPreviewEvent).not.toBeNull())
        await act(async () => {
          onPreviewEvent?.({
            ownerKey: previewOwnerKey,
            tabId: 'tab-1',
            type: 'grab',
            payload: SAMPLE_PAYLOAD,
            at: Date.now()
          })
        })

        const sendGrabButton = await screen.findByTestId('design-grab-send')
        await act(async () => {
          fireEvent.click(sendGrabButton)
        })

        await waitFor(() => expect(sentToAgent).toHaveBeenCalledTimes(1))
        expect(screen.getAllByTestId('preview-element-chip')).toHaveLength(1)

        const chip = screen.getByTestId('preview-element-chip')
        expect(chip).toHaveAttribute('data-ui', 'preview-element-chip')
        expect(within(chip).getByTestId('preview-element-label')).toHaveTextContent('Finalizar compra')
        expect(within(chip).getByTestId('preview-element-selector')).toHaveTextContent('main > button.checkout-cta')

        // Uses IconButton primitive from src/ui (data-ui="icon-button"), 0 raw <button>.
        const buttonsInChip = chip.querySelectorAll('button')
        expect(buttonsInChip).toHaveLength(1)
        expect(buttonsInChip[0]).toHaveAttribute('data-ui', 'icon-button')

        // Raw markup block is NOT pasted into the composer textarea, and no eager image attachment is added.
        const composer = screen.getByRole('textbox', {
          name: combo.lang === 'pt-BR' ? 'Mensagem' : 'Message',
          exact: true
        }) as HTMLTextAreaElement
        expect(composer.value).toBe('')
        expect(composer.value).not.toContain('The user selected an element in the web preview.')
        expect(useThreadStore.getState().attachments[snapshot.thread.id] ?? []).toHaveLength(0)
        expect(api.attach).not.toHaveBeenCalled()
      } finally {
        cleanup()
        Object.defineProperty(window, 'oxe', { configurable: true, value: previous })
      }
    }
  })

  it('removes the element reference from the outgoing message when the chip is dismissed', async () => {
    for (const lang of ['en', 'pt-BR'] as const) {
      await changeLanguage(lang)
      const { snapshot, api, workspace } = setupThreadFixture()
      const ref = makeElementRef()
      useThreadStore.getState().addPreviewElement(snapshot.thread.id, ref)

      const previous = window.oxe
      Object.defineProperty(window, 'oxe', {
        configurable: true,
        value: {
          thread: api,
          agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) }
        }
      })

      try {
        render(<ThreadView workspace={workspace} />)
        expect(screen.getAllByTestId('preview-element-chip')).toHaveLength(1)

        const removeLabel = lang === 'pt-BR'
          ? `Remover elemento ${ref.label} (${ref.selector})`
          : `Remove element ${ref.label} (${ref.selector})`
        const removeButton = screen.getByRole('button', { name: removeLabel })
        expect(removeButton).toHaveAttribute('data-ui', 'icon-button')

        fireEvent.click(removeButton)

        expect(screen.queryAllByTestId('preview-element-chip')).toHaveLength(0)
        expect(useThreadStore.getState().previewElements[snapshot.thread.id] ?? []).toHaveLength(0)

        const composer = screen.getByRole('textbox', {
          name: lang === 'pt-BR' ? 'Mensagem' : 'Message',
          exact: true
        })
        fireEvent.change(composer, { target: { value: 'Apenas ajuste o espaçamento' } })
        fireEvent.keyDown(composer, { key: 'Enter' })

        expect(api.send).toHaveBeenCalledTimes(1)
        expect(api.send).toHaveBeenCalledWith(snapshot.thread.id, 'Apenas ajuste o espaçamento', [])
        expect(composeMessageWithElements('Apenas ajuste o espaçamento', [])).toBe('Apenas ajuste o espaçamento')
      } finally {
        cleanup()
        Object.defineProperty(window, 'oxe', { configurable: true, value: previous })
      }
    }
  })
})
