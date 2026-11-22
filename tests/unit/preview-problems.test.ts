import { createElement } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { addPreviewProblem, formatPreviewProblems, isFailedRequest, MAX_PREVIEW_PROBLEMS, NO_PREVIEW_PROBLEMS, previewProblemCount, previewVerifyNote } from '../../shared/preview-problems'
import type { BrowserPreviewEvent, BrowserPreviewSessionState } from '../../shared/types/browser-preview'
import type { Workspace } from '../../shared/types/workspace'
import { WebPreviewPanel } from '../../src/components/WebPreview/WebPreviewPanel'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('preview problems: what broke in the page since it loaded', () => {
  test('console errors count; warnings and info do not', () => {
    let problems = NO_PREVIEW_PROBLEMS
    problems = addPreviewProblem(problems, { level: 'warning', message: 'deprecated', source: 'a.js', line: 1 })
    problems = addPreviewProblem(problems, { level: 'info', message: 'ready', source: 'a.js', line: 2 })
    problems = addPreviewProblem(problems, { level: 'error', message: 'x is not defined', source: 'http://localhost:5173/src/App.tsx', line: 12 })
    expect(previewProblemCount(problems)).toBe(1)
    expect(problems.console[0].message).toBe('x is not defined')
  })

  test('a request fails with a network error or an answer of 400 and above; a cancelled one is not a problem', () => {
    expect(isFailedRequest({ method: 'GET', url: '/api', status: 500, type: 'fetch', ms: 3 })).toBe(true)
    expect(isFailedRequest({ method: 'GET', url: '/api', status: 404, type: 'fetch', ms: 3 })).toBe(true)
    expect(isFailedRequest({ method: 'GET', url: '/api', status: null, type: 'fetch', ms: null, failed: 'error' })).toBe(true)
    expect(isFailedRequest({ method: 'GET', url: '/api', status: null, type: 'fetch', ms: null, failed: 'canceled' })).toBe(false)
    expect(isFailedRequest({ method: 'GET', url: '/api', status: 304, type: 'fetch', ms: 3 })).toBe(false)
  })

  test('the same problem is kept once, and a page that floods does not fill the list', () => {
    let problems = NO_PREVIEW_PROBLEMS
    for (let i = 0; i < 5; i++) problems = addPreviewProblem(problems, { level: 'error', message: 'boom', source: 'a.js', line: 1 })
    expect(problems.console).toHaveLength(1)
    for (let i = 0; i < 60; i++) problems = addPreviewProblem(problems, { level: 'error', message: `boom ${i}`, source: 'a.js', line: i })
    expect(problems.console).toHaveLength(MAX_PREVIEW_PROBLEMS)
    for (let i = 0; i < 3; i++) problems = addPreviewProblem(problems, { method: 'GET', url: '/api/cart', status: 500, type: 'fetch', ms: 9 })
    expect(problems.network).toHaveLength(1)
  })

  test('nothing is changed when the row is not a problem', () => {
    const before = NO_PREVIEW_PROBLEMS
    expect(addPreviewProblem(before, { method: 'GET', url: '/ok', status: 200, type: 'fetch', ms: 2 })).toBe(before)
  })

  test('the prompt says where, what the console said and which requests failed, on one line each', () => {
    const text = formatPreviewProblems('http://localhost:5173/', {
      console: [{ level: 'error', message: 'TypeError: x is\n   not a function', source: 'http://localhost:5173/src/Cart.tsx', line: 30 }],
      network: [{ method: 'POST', url: 'http://localhost:5173/api/cart', status: 500, type: 'fetch', ms: 14 }, { method: 'GET', url: 'http://localhost:5173/logo.png', status: null, type: 'image', ms: null, failed: 'error' }]
    })
    expect(text).toBe([
      'The web preview at http://localhost:5173/ shows problems since the page last loaded.',
      '',
      'Console errors:',
      '- TypeError: x is not a function (http://localhost:5173/src/Cart.tsx:30)',
      '',
      'Failed requests:',
      '- POST http://localhost:5173/api/cart → 500',
      '- GET http://localhost:5173/logo.png → network error',
      '',
      'Find the cause in the project and fix it.'
    ].join('\n'))
    expect(formatPreviewProblems('http://localhost:3000/', { console: [], network: [{ method: 'GET', url: '/x', status: 404, type: 'fetch', ms: 1 }] }, '  only the 404  ')).toContain('User request:\nonly the 404')
  })

  test('the note for an agent that can see the preview names the two tools and nothing of the page', () => {
    const note = previewVerifyNote('http://localhost:5173/')
    expect(note).toContain('<oxespace-preview>')
    expect(note).toContain('http://localhost:5173/')
    expect(note).toContain('oxespace_capture_web_preview')
    expect(note).toContain('oxespace_preview_interact')
    expect(note.trimEnd().endsWith('</oxespace-preview>')).toBe(true)
  })

  test('counts failed network requests in Web Preview problem counter', async () => {
    let problems = NO_PREVIEW_PROBLEMS
    problems = addPreviewProblem(problems, { method: 'GET', url: 'http://127.0.0.1:4321/api/items', status: 500, type: 'fetch', ms: 14 })
    expect(previewProblemCount(problems)).toBe(1)
    problems = addPreviewProblem(problems, { method: 'POST', url: 'http://127.0.0.1:4321/api/checkout', status: null, type: 'fetch', ms: null, failed: 'error' })
    expect(previewProblemCount(problems)).toBe(2)

    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    if (!HTMLElement.prototype.checkVisibility) {
      Object.defineProperty(HTMLElement.prototype, 'checkVisibility', { configurable: true, value: () => true })
    }
    let listener: ((event: BrowserPreviewEvent) => void) | null = null
    const previous = window.oxe
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        fs: { readFile: vi.fn(async () => ({ content: '' })), listTree: vi.fn(async () => []) },
        browserPreview: {
          session: vi.fn(async () => ({
            ownerKey: 'project-oxe-10',
            activeTabId: 'tab-1',
            tabs: [{ id: 'tab-1', url: 'http://127.0.0.1:4321/', loading: false, error: null, canGoBack: false, canGoForward: false }]
          } as BrowserPreviewSessionState)),
          onEvent: vi.fn((cb: (event: BrowserPreviewEvent) => void) => {
            listener = cb
            return () => {}
          }),
          designMode: vi.fn(async () => ({ enabled: false })),
          setAccess: vi.fn(async () => ({ allowed: false })),
          mount: vi.fn(async () => ({ lease: 'lease-1' })),
          close: vi.fn(async () => {}),
          setZoom: vi.fn(async () => {}),
          bounds: vi.fn(async () => {})
        }
      }
    })

    try {
      render(createElement(WebPreviewPanel, {
        workspace: { id: 'project-oxe-10', name: 'Project' } as Workspace,
        onRunCommand: () => {},
        onClose: () => {}
      }))
      await waitFor(() => expect(listener).not.toBeNull())
      expect(screen.queryByTestId('preview-problems')).toBeNull()

      // Non-failed network requests (200 OK) do not trigger the problem counter.
      await act(async () => {
        listener?.({
          ownerKey: 'project-oxe-10',
          tabId: 'tab-1',
          type: 'network',
          row: { method: 'GET', url: 'http://127.0.0.1:4321/ok', status: 200, type: 'fetch', ms: 4 },
          at: Date.now()
        })
      })
      expect(screen.queryByTestId('preview-problems')).toBeNull()

      // HTTP >= 400 increments the counter and reveals [data-testid="preview-problems"].
      await act(async () => {
        listener?.({
          ownerKey: 'project-oxe-10',
          tabId: 'tab-1',
          type: 'network',
          row: { method: 'GET', url: 'http://127.0.0.1:4321/api/items', status: 500, type: 'fetch', ms: 14 },
          at: Date.now()
        })
      })
      const badge = await screen.findByTestId('preview-problems')
      expect(badge).toHaveTextContent(/1/)

      // Connection error (failed: 'error') also increments the visible counter.
      await act(async () => {
        listener?.({
          ownerKey: 'project-oxe-10',
          tabId: 'tab-1',
          type: 'network',
          row: { method: 'POST', url: 'http://127.0.0.1:4321/api/checkout', status: null, type: 'fetch', ms: null, failed: 'error' },
          at: Date.now()
        })
      })
      expect(screen.getByTestId('preview-problems')).toHaveTextContent(/2/)
    } finally {
      cleanup()
      Object.defineProperty(window, 'oxe', { configurable: true, value: previous })
    }
  })
})
