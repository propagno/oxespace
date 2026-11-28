import { createElement } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { NetworkLog } from '../../electron/main/services/browser-preview/preview-observe'
import {
  addPreviewProblem,
  formatPreviewProblems,
  isFailedRequest,
  isLocalPreviewUrl,
  NO_PREVIEW_PROBLEMS,
  previewProblemCount
} from '../../shared/preview-problems'
import type { BrowserPreviewEvent, BrowserPreviewSessionState } from '../../shared/types/browser-preview'
import type { Workspace } from '../../shared/types/workspace'
import { WebPreviewPanel } from '../../src/components/WebPreview/WebPreviewPanel'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OXE-489 · WebPreview CDP errorText, ERR_ABORTED classification & external site filter', () => {
  test('Network.loadingFailed treats net::ERR_ABORTED and net::ERR_BLOCKED_BY_CLIENT as canceled even without canceled: true', () => {
    const log = new NetworkLog()

    log.add({
      method: 'Network.requestWillBeSent',
      params: { requestId: 'r-aborted', timestamp: 1, type: 'Fetch', request: { method: 'GET', url: 'https://www.google.com/async' } }
    })
    const abortedRow = log.add({
      method: 'Network.loadingFailed',
      params: { requestId: 'r-aborted', timestamp: 1.2, errorText: 'net::ERR_ABORTED' }
    })

    log.add({
      method: 'Network.requestWillBeSent',
      params: { requestId: 'r-blocked', timestamp: 2, type: 'Script', request: { method: 'GET', url: 'https://tracker.example/pixel.js' } }
    })
    const blockedRow = log.add({
      method: 'Network.loadingFailed',
      params: { requestId: 'r-blocked', timestamp: 2.1, errorText: '  net::ERR_BLOCKED_BY_CLIENT  ' }
    })

    expect(abortedRow).toEqual({
      method: 'GET',
      url: 'https://www.google.com/async',
      status: null,
      type: 'fetch',
      ms: 200,
      failed: 'canceled'
    })
    expect(abortedRow?.errorText).toBeUndefined()
    expect(isFailedRequest(abortedRow!)).toBe(false)

    expect(blockedRow).toEqual({
      method: 'GET',
      url: 'https://tracker.example/pixel.js',
      status: null,
      type: 'script',
      ms: 100,
      failed: 'canceled'
    })
    expect(blockedRow?.errorText).toBeUndefined()
    expect(isFailedRequest(blockedRow!)).toBe(false)
  })

  test('Network.loadingFailed preserves errorText on real errors and formatPreviewProblems displays it', () => {
    const log = new NetworkLog()

    log.add({
      method: 'Network.requestWillBeSent',
      params: { requestId: 'r-refused', timestamp: 1, type: 'Fetch', request: { method: 'GET', url: 'http://localhost:5173/api/health' } }
    })
    const refusedRow = log.add({
      method: 'Network.loadingFailed',
      params: { requestId: 'r-refused', timestamp: 1.35, errorText: '  net::ERR_CONNECTION_REFUSED  ' }
    })

    expect(refusedRow).toEqual({
      method: 'GET',
      url: 'http://localhost:5173/api/health',
      status: null,
      type: 'fetch',
      ms: 350,
      failed: 'error',
      errorText: 'net::ERR_CONNECTION_REFUSED'
    })
    expect(isFailedRequest(refusedRow!)).toBe(true)

    const formatted = formatPreviewProblems('http://localhost:5173/', {
      console: [],
      network: [
        refusedRow!,
        { method: 'GET', url: 'http://localhost:5173/no-detail', status: null, type: 'fetch', ms: null, failed: 'error' }
      ]
    })

    expect(formatted).toContain('- GET http://localhost:5173/api/health → net::ERR_CONNECTION_REFUSED')
    expect(formatted).toContain('- GET http://localhost:5173/no-detail → network error')
    expect(formatted).toContain('Find the cause in the project and fix it.')
  })

  test('isLocalPreviewUrl distinguishes local dev / LAN / file URLs from public external websites', () => {
    const localUrls = [
      'http://localhost:5173/',
      'https://localhost/app',
      'http://127.0.0.1:3000/',
      'http://[::1]:8080/',
      'http://0.0.0.0:4000/',
      'http://web.localhost:5173/',
      'http://devbox.local:8000/',
      'file:///C:/Users/dev/index.html',
      'http://192.168.1.42:3000/',
      'http://10.0.0.15:8080/',
      'http://172.16.0.1:3000/',
      'http://172.31.255.254/'
    ]
    for (const url of localUrls) {
      expect(isLocalPreviewUrl(url), url).toBe(true)
    }

    const externalUrls = [
      'https://www.google.com/',
      'https://fonts.gstatic.com/s/roboto.woff2',
      'http://172.15.0.1/',
      'http://172.32.0.1/',
      'http://10.example.com/',
      'http://192.168.evil.com/',
      'not-a-url',
      ''
    ]
    for (const url of externalUrls) {
      expect(isLocalPreviewUrl(url), url).toBe(false)
    }
  })

  test('ignores external site subresource failures while keeping local preview failures intact', () => {
    const failedFont = {
      method: 'GET',
      url: 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff2',
      status: null,
      type: 'font',
      ms: 85,
      failed: 'error' as const,
      errorText: 'net::ERR_QUIC_PROTOCOL_ERROR'
    }

    // External page + third-party font failure -> ignored.
    const externalProblems = addPreviewProblem(NO_PREVIEW_PROBLEMS, failedFont, 'https://www.google.com/')
    expect(externalProblems).toBe(NO_PREVIEW_PROBLEMS)
    expect(previewProblemCount(externalProblems)).toBe(0)

    // External page + cross-origin document failure -> ignored.
    const externalCrossOriginDoc = addPreviewProblem(
      NO_PREVIEW_PROBLEMS,
      { method: 'GET', url: 'https://ads.example.com/frame', status: 500, type: 'document', ms: 40 },
      'https://www.google.com/'
    )
    expect(previewProblemCount(externalCrossOriginDoc)).toBe(0)

    // External page + same-origin main document failure -> kept.
    const externalMainDoc = addPreviewProblem(
      NO_PREVIEW_PROBLEMS,
      { method: 'GET', url: 'https://www.google.com/', status: 503, type: 'document', ms: 120 },
      'https://www.google.com/'
    )
    expect(previewProblemCount(externalMainDoc)).toBe(1)

    // Local preview + third-party font failure -> still captured for the developer.
    const localProblems = addPreviewProblem(NO_PREVIEW_PROBLEMS, failedFont, 'http://localhost:5173/')
    expect(previewProblemCount(localProblems)).toBe(1)
    expect(localProblems.network[0].errorText).toBe('net::ERR_QUIC_PROTOCOL_ERROR')

    // External formatPreviewProblems prompt uses neutral instruction instead of suggesting a project fix.
    const externalPrompt = formatPreviewProblems('https://www.google.com/', externalMainDoc)
    expect(externalPrompt).not.toContain('Find the cause in the project and fix it.')
    expect(externalPrompt).toContain('Inspect the errors above and explain what failed.')
  })

  test('WebPreviewPanel does not show problem badge for external site subresource failures, but still captures them on localhost', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    if (!HTMLElement.prototype.checkVisibility) {
      Object.defineProperty(HTMLElement.prototype, 'checkVisibility', { configurable: true, value: () => true })
    }

    const previous = window.oxe
    const mountPanel = async (pageUrl: string, onSendToAgent?: (prompt: string) => void) => {
      let listener: ((event: BrowserPreviewEvent) => void) | null = null
      Object.defineProperty(window, 'oxe', {
        configurable: true,
        value: {
          fs: { readFile: vi.fn(async () => ({ content: '' })), listTree: vi.fn(async () => []) },
          browserPreview: {
            session: vi.fn(async () => ({
              ownerKey: 'project-oxe-489',
              sessionId: 'session-oxe-489',
              activeTabId: 'tab-1',
              allowExternal: true,
              tabs: [{ id: 'tab-1', url: pageUrl, title: 'Preview', loading: false, error: null, canGoBack: false, canGoForward: false }]
            } as BrowserPreviewSessionState)),
            onEvent: vi.fn((cb: (event: BrowserPreviewEvent) => void) => {
              listener = cb
              return () => {}
            }),
            designMode: vi.fn(async () => ({ enabled: false })),
            setAccess: vi.fn(async () => ({ agentAccess: false })),
            mount: vi.fn(async () => ({ lease: 'lease-1' })),
            close: vi.fn(async () => {}),
            setZoom: vi.fn(async () => {}),
            bounds: vi.fn(async () => {})
          }
        }
      })

      render(createElement(WebPreviewPanel, {
        workspace: { id: 'project-oxe-489', name: 'Project', rootPath: '' } as Workspace,
        onClose: () => {},
        onSendToAgent
      }))
      await waitFor(() => expect(listener).not.toBeNull())
      return { emit: (event: BrowserPreviewEvent) => listener?.(event) }
    }

    try {
      // 1. External site: failed third-party font + canceled request should NOT show problem banner.
      const external = await mountPanel('https://www.google.com/')
      await act(async () => {
        external.emit({
          ownerKey: 'project-oxe-489',
          tabId: 'tab-1',
          type: 'network',
          row: {
            method: 'GET',
            url: 'https://fonts.gstatic.com/s/roboto/v30/font.woff2',
            status: null,
            type: 'font',
            ms: 90,
            failed: 'error',
            errorText: 'net::ERR_QUIC_PROTOCOL_ERROR'
          },
          at: Date.now()
        })
        external.emit({
          ownerKey: 'project-oxe-489',
          tabId: 'tab-1',
          type: 'network',
          row: {
            method: 'GET',
            url: 'https://www.google.com/aborted',
            status: null,
            type: 'fetch',
            ms: 15,
            failed: 'canceled'
          },
          at: Date.now()
        })
      })
      expect(screen.queryByTestId('preview-problems')).toBeNull()
      cleanup()

      // 2. Local preview: same failed font request SHOULD show problem banner and forward errorText.
      const sentPrompts: string[] = []
      const local = await mountPanel('http://localhost:5173/', prompt => { sentPrompts.push(prompt) })
      await act(async () => {
        local.emit({
          ownerKey: 'project-oxe-489',
          tabId: 'tab-1',
          type: 'network',
          row: {
            method: 'GET',
            url: 'https://fonts.gstatic.com/s/roboto/v30/font.woff2',
            status: null,
            type: 'font',
            ms: 90,
            failed: 'error',
            errorText: 'net::ERR_QUIC_PROTOCOL_ERROR'
          },
          at: Date.now()
        })
      })
      const badge = await screen.findByTestId('preview-problems')
      expect(badge).toHaveTextContent(/1/)

      fireEvent.click(screen.getByTestId('preview-problems-send'))
      await waitFor(() => expect(sentPrompts).toHaveLength(1))
      expect(sentPrompts[0]).toContain('net::ERR_QUIC_PROTOCOL_ERROR')
      expect(sentPrompts[0]).toContain('Find the cause in the project and fix it.')
    } finally {
      cleanup()
      Object.defineProperty(window, 'oxe', { configurable: true, value: previous })
    }
  })
})
