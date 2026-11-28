// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../src/i18n'

const mermaidParse = vi.fn(async (code: string) => /^(graph|flowchart|sequenceDiagram)\b/.test(code.trim()))
const mermaidRender = vi.fn(async (id: string, code: string) => ({
  svg: `<svg id="${id}" viewBox="0 0 120 60"><g><text>${code.split('\n')[1]?.trim() ?? 'diagram'}</text></g></svg>`
}))
const mermaidInitialize = vi.fn()
vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidInitialize,
    parse: mermaidParse,
    render: mermaidRender
  }
}))

import { splitStreamingMarkdownBlocks } from '../../src/components/Threads/streamingMarkdownBlocks'
import { observeElementResize, resetSharedResizeObserverForTest } from '../../src/components/Threads/sharedResizeObserver'
import { ThreadMarkdown } from '../../src/components/Threads/ThreadMarkdown'
import { ThreadTimelineWindow } from '../../src/components/Threads/ThreadTimeline'
import {
  clearMermaidSvgCacheForTest,
  MAX_MERMAID_SVG_CACHE,
  MermaidDiagram
} from '../../src/components/Threads/ThreadMermaid'
import * as threadRenderClient from '../../src/components/Threads/threadRenderClient'
import { parseThreadMarkdown } from '../../src/components/Threads/threadRenderCore'
import { installStubWorker, renderWorker } from '../oxe160/oxe125/render-worker-stub'

beforeEach(() => {
  threadRenderClient.resetThreadRenderClientForTest()
  resetSharedResizeObserverForTest()
  clearMermaidSvgCacheForTest()
  mermaidParse.mockClear()
  mermaidRender.mockClear()
  mermaidInitialize.mockClear()
})

afterEach(() => {
  cleanup()
  threadRenderClient.resetThreadRenderClientForTest()
  resetSharedResizeObserverForTest()
  clearMermaidSvgCacheForTest()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OXE-485 · splitStreamingMarkdownBlocks', () => {
  it('separates closed paragraphs, headings, fences, tables, and alerts into stableBlocks + activeTail', () => {
    const md = [
      '## Architecture',
      '',
      'Introductory paragraph with **bold** text.',
      '',
      '```ts',
      'const a = 1',
      '',
      'const b = 2',
      '```',
      '',
      '| Name | Value |',
      '| --- | ---: |',
      '| alpha | 10 |',
      '',
      '> [!NOTE]',
      '> First alert paragraph.',
      '>',
      '> Second alert paragraph.',
      '',
      'Still streaming this tail'
    ].join('\n')

    const split = splitStreamingMarkdownBlocks(md)
    expect(split.stableBlocks).toEqual([
      '## Architecture',
      'Introductory paragraph with **bold** text.',
      '```ts\nconst a = 1\n\nconst b = 2\n```',
      '| Name | Value |\n| --- | ---: |\n| alpha | 10 |',
      '> [!NOTE]\n> First alert paragraph.\n>\n> Second alert paragraph.'
    ])
    expect(split.activeTail).toBe('Still streaming this tail')
  })

  it('NEVER splits inside open backtick/tilde code fences even when they contain blank lines', () => {
    const openBacktick = 'Intro.\n\n```ts\nconst first = 1\n\nconst second = 2\n'
    expect(splitStreamingMarkdownBlocks(openBacktick)).toEqual({
      stableBlocks: ['Intro.'],
      activeTail: '```ts\nconst first = 1\n\nconst second = 2\n'
    })

    const openTilde = '~~~python\ndef f():\n\n    return 1\n'
    expect(splitStreamingMarkdownBlocks(openTilde)).toEqual({
      stableBlocks: [],
      activeTail: openTilde
    })

    const nestedFourBackticks = '````markdown\n```ts\nconst x = 1\n```\n\nstill inside outer fence'
    expect(splitStreamingMarkdownBlocks(nestedFourBackticks)).toEqual({
      stableBlocks: [],
      activeTail: nestedFourBackticks
    })

    const fenceWithoutPrecedingBlankLine = 'Here is code:\n```ts\nconst a = 1\n\nconst b = 2'
    expect(splitStreamingMarkdownBlocks(fenceWithoutPrecedingBlankLine)).toEqual({
      stableBlocks: [],
      activeTail: fenceWithoutPrecedingBlankLine
    })
  })

  it('NEVER splits inside open $$ or \\[ display math blocks, and splits cleanly once closed', () => {
    const openDollarMath = 'Formula:\n\n$$\na = 1\n\nb = 2'
    expect(splitStreamingMarkdownBlocks(openDollarMath)).toEqual({
      stableBlocks: ['Formula:'],
      activeTail: '$$\na = 1\n\nb = 2'
    })

    const closedDollarMath = 'Formula:\n\n$$\na = 1\n\nb = 2\n$$\n\nAfter'
    expect(splitStreamingMarkdownBlocks(closedDollarMath)).toEqual({
      stableBlocks: ['Formula:', '$$\na = 1\n\nb = 2\n$$'],
      activeTail: 'After'
    })

    const openBracketMath = '\\[\nx^2 + y^2\n\n= z^2'
    expect(splitStreamingMarkdownBlocks(openBracketMath)).toEqual({
      stableBlocks: [],
      activeTail: openBracketMath
    })

    const singleLineMath = '$$E = mc^2$$\n\nNext'
    expect(splitStreamingMarkdownBlocks(singleLineMath)).toEqual({
      stableBlocks: ['$$E = mc^2$$'],
      activeTail: 'Next'
    })
  })

  it('NEVER splits an incomplete table, a single trailing newline, or a loose/continuing list', () => {
    const singleNewline = 'First line\n'
    expect(splitStreamingMarkdownBlocks(singleNewline)).toEqual({
      stableBlocks: [],
      activeTail: singleNewline
    })

    const streamingTable = 'Intro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |'
    expect(splitStreamingMarkdownBlocks(streamingTable)).toEqual({
      stableBlocks: ['Intro'],
      activeTail: '| A | B |\n| --- | --- |\n| 1 | 2 |'
    })

    const trailingBlankList = '- item 1\n\n'
    expect(splitStreamingMarkdownBlocks(trailingBlankList)).toEqual({
      stableBlocks: [],
      activeTail: trailingBlankList
    })

    const looseList = '- item 1\n\n  continuation\n\n- item 2\n\nAfter list'
    expect(splitStreamingMarkdownBlocks(looseList)).toEqual({
      stableBlocks: ['- item 1\n\n  continuation\n\n- item 2'],
      activeTail: 'After list'
    })
  })

  it('falls back gracefully when reference link definitions appear outside fences, but still splits when only inside fences', () => {
    const withRefDef = 'See [docs][d].\n\nAnother paragraph.\n\n[d]: https://example.com'
    expect(splitStreamingMarkdownBlocks(withRefDef)).toEqual({
      stableBlocks: [],
      activeTail: withRefDef
    })

    const refInsideFence = 'Intro.\n\n```md\n[d]: https://example.com\n```\n\nTail'
    expect(splitStreamingMarkdownBlocks(refInsideFence)).toEqual({
      stableBlocks: ['Intro.', '```md\n[d]: https://example.com\n```'],
      activeTail: 'Tail'
    })
  })
})

describe('OXE-485 · Incremental streaming ThreadMarkdown (O(1) per chunk)', () => {
  it('does NOT re-parse earlier stable blocks across 25 incremental streaming updates (sync fallback)', () => {
    const parseSpy = vi.spyOn(threadRenderClient, 'parseThreadMarkdownSync')

    const block0 = '## Overview\n\nFirst settled paragraph with **bold** and `src/app.ts`.'
    const block1 = '```ts\nexport const answer = 42\n```'
    const block2 = '| Metric | Score |\n| --- | ---: |\n| Throughput | 99 |'
    const block3 = '> [!TIP]\n> Incremental blocks stay memoized.'

    const prefix = [block0, block1, block2, block3].join('\n\n')
    const initialText = `${prefix}\n\nStreaming tail token 0`

    const { rerender, container } = render(<ThreadMarkdown streaming text={initialText} />)

    // Initial mount parses each stable block once + active tail once.
    const initialCalls = parseSpy.mock.calls.length
    expect(initialCalls).toBe(6) // 5 stable blocks (heading, p, code, table, alert) + 1 active tail

    parseSpy.mockClear()

    // Stream 25 incremental chunks appending only to the active tail.
    let current = initialText
    for (let i = 1; i <= 25; i++) {
      current += ` token-${i}`
      rerender(<ThreadMarkdown streaming text={current} />)
    }

    // Exactly 1 sync parse per chunk — ONLY the short active tail, NEVER earlier stable blocks!
    expect(parseSpy).toHaveBeenCalledTimes(25)
    for (const [parsedArg] of parseSpy.mock.calls) {
      expect(parsedArg).not.toContain('## Overview')
      expect(parsedArg).not.toContain('export const answer = 42')
      expect(parsedArg).not.toContain('| Throughput | 99 |')
      expect(parsedArg).toContain('Streaming tail token 0')
    }

    // All rendered rich Markdown elements remain intact in the DOM.
    expect(container.querySelector('h2')?.textContent).toBe('Overview')
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('.thread-alert[data-kind="tip"]')).not.toBeNull()
    expect(container.textContent).toContain('token-25')
  })

  it('offloads settled streaming blocks to the Web Worker + LRU cache once while parsing only activeTail synchronously', async () => {
    installStubWorker()
    const parseSpy = vi.spyOn(threadRenderClient, 'parseThreadMarkdownSync')

    const block0 = 'Settled paragraph with **strong** text.'
    const block1 = '```diff\n-old line\n+new line\n```'
    let tail = 'Active tail chunk 0'

    const { rerender, container } = render(
      <ThreadMarkdown streaming text={`${block0}\n\n${block1}\n\n${tail}`} />
    )

    const worker = renderWorker()!
    expect(worker).toBeDefined()
    expect(worker.posted).toHaveLength(2)
    expect(worker.posted.map(item => item.text)).toEqual([block0, block1])
    // Only activeTail ran synchronously!
    expect(parseSpy).toHaveBeenCalledTimes(1)
    expect(parseSpy).toHaveBeenLastCalledWith(tail)

    // Worker replies for both settled blocks.
    act(() => {
      for (const req of worker.posted) {
        worker.reply({ id: req.id, tree: parseThreadMarkdown(req.text) })
      }
    })

    await waitFor(() => {
      expect(container.querySelector('strong')?.textContent).toBe('strong')
      expect(container.querySelector('code .tk-added')).not.toBeNull()
      expect(container.querySelector('code .tk-removed')).not.toBeNull()
    })

    // Stream 20 more chunks to activeTail: ZERO new worker posts, ZERO re-parses of block0/block1.
    parseSpy.mockClear()
    for (let i = 1; i <= 20; i++) {
      tail += ` word${i}`
      rerender(<ThreadMarkdown streaming text={`${block0}\n\n${block1}\n\n${tail}`} />)
    }
    expect(worker.posted).toHaveLength(2)
    expect(parseSpy).toHaveBeenCalledTimes(20)
    expect(parseSpy.mock.calls.every(([arg]) => arg.startsWith('Active tail chunk 0'))).toBe(true)

    // When a brand-new 3rd block settles, only that 1 new block is posted to the worker.
    const settledTail = tail
    rerender(<ThreadMarkdown streaming text={`${block0}\n\n${block1}\n\n${settledTail}\n\nNext tail`} />)
    expect(worker.posted).toHaveLength(3)
    expect(worker.posted[2].text).toBe(settledTail)

    // When streaming finishes (streaming=false), the full settled document uses the single-worker contract.
    const finalText = `${block0}\n\n${block1}\n\n${settledTail}\n\nNext tail`
    rerender(<ThreadMarkdown streaming={false} text={finalText} />)
    expect(worker.posted).toHaveLength(4)
    expect(worker.posted[3].text).toBe(finalText)
  })
})

describe('OXE-485 · Single shared ResizeObserver in ThreadTimeline', () => {
  class MockResizeObserver {
    static instances: MockResizeObserver[] = []
    readonly observed = new Set<Element>()
    readonly unobserved: Element[] = []
    disconnected = false

    constructor(private readonly callback: ResizeObserverCallback) {
      MockResizeObserver.instances.push(this)
    }

    observe(target: Element): void {
      this.observed.add(target)
    }

    unobserve(target: Element): void {
      this.observed.delete(target)
      this.unobserved.push(target)
    }

    disconnect(): void {
      this.disconnected = true
      this.observed.clear()
    }

    trigger(target: Element): void {
      const entry = {
        target,
        contentRect: target.getBoundingClientRect(),
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: []
      } as unknown as ResizeObserverEntry
      this.callback([entry], this as unknown as ResizeObserver)
    }
  }

  it('instantiates exactly 1 ResizeObserver for 30 mounted MeasuredTimelineRow items and cleans up cleanly', () => {
    MockResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const scroll = document.createElement('div')
    // Large viewport so all 30 rows mount simultaneously (30 * 132 = 3960px <= 5000px).
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => 5000 })
    const scrollRef = createRef<HTMLDivElement>()
    ;(scrollRef as { current: HTMLDivElement | null }).current = scroll
    const followingRef = { current: false }
    const rows = Array.from({ length: 30 }, (_, index) => ({ key: `row-${index}`, label: `Message ${index}` }))

    const { container, unmount } = render(
      <ThreadTimelineWindow rows={rows} scrollRef={scrollRef} followingRef={followingRef}>
        {row => <div>{row.label}</div>}
      </ThreadTimelineWindow>
    )

    const mountedRows = container.querySelectorAll('.thread-virtual-row')
    expect(mountedRows).toHaveLength(30)

    // CRITICAL: Exactly 1 shared ResizeObserver across the scroll container + all 30 rows!
    expect(MockResizeObserver.instances).toHaveLength(1)
    const observer = MockResizeObserver.instances[0]
    expect(observer.observed.has(scroll)).toBe(true)
    for (const rowNode of mountedRows) {
      expect(observer.observed.has(rowNode)).toBe(true)
    }
    expect(observer.observed.size).toBe(31)

    unmount()
    expect(observer.observed.size).toBe(0)
    expect(observer.unobserved.length).toBe(31)
  })

  it('dispatches only to the resized target callbacks, supports multiple listeners, and adapts to swapped ResizeObserver mocks', () => {
    MockResizeObserver.instances = []
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const elA = document.createElement('div')
    const elB = document.createElement('div')
    const cbA1 = vi.fn()
    const cbA2 = vi.fn()
    const cbB = vi.fn()

    const stopA1 = observeElementResize(elA, cbA1)
    const stopA2 = observeElementResize(elA, cbA2)
    const stopB = observeElementResize(elB, cbB)

    expect(MockResizeObserver.instances).toHaveLength(1)
    const firstObserver = MockResizeObserver.instances[0]
    firstObserver.trigger(elA)
    expect(cbA1).toHaveBeenCalledTimes(1)
    expect(cbA2).toHaveBeenCalledTimes(1)
    expect(cbB).not.toHaveBeenCalled()

    // Removing one listener on elA keeps elA observed for cbA2.
    stopA1()
    expect(firstObserver.observed.has(elA)).toBe(true)
    firstObserver.trigger(elA)
    expect(cbA1).toHaveBeenCalledTimes(1)
    expect(cbA2).toHaveBeenCalledTimes(2)

    // Removing last listener on elA unobserves elA cleanly (and idempotently).
    stopA2()
    stopA2()
    expect(firstObserver.observed.has(elA)).toBe(false)
    stopB()
    expect(firstObserver.observed.size).toBe(0)

    // Swapping global ResizeObserver creates a fresh singleton cleanly.
    class SecondMockObserver extends MockResizeObserver {}
    vi.stubGlobal('ResizeObserver', SecondMockObserver)
    const stopAfterSwap = observeElementResize(elA, cbA1)
    expect(firstObserver.disconnected).toBe(true)
    expect(MockResizeObserver.instances).toHaveLength(2)
    stopAfterSwap()
  })
})

describe('OXE-485 · MermaidDiagram bounded SVG LRU cache across virtualizer unmount/remount', () => {
  it('restores cached SVG instantaneously on remount without re-invoking mermaid.render', async () => {
    const code = 'graph TD\n  A[Start] --> B[End]'

    const first = render(<MermaidDiagram code={code} />)
    await waitFor(() => {
      expect(first.container.querySelector('.thread-diagram svg')).not.toBeNull()
    })
    expect(mermaidRender).toHaveBeenCalledTimes(1)

    // Simulate scrolling past virtualizer overscan (±6): component unmounts.
    first.unmount()

    // Scroll back: component remounts and MUST show SVG synchronously on first paint with 0 new renders!
    mermaidRender.mockClear()
    const second = render(<MermaidDiagram code={code} />)
    expect(second.container.querySelector('.thread-diagram svg')).not.toBeNull()
    expect(second.container.querySelector('.thread-diagram')?.textContent).toContain('A[Start] --> B[End]')
    expect(mermaidRender).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Show code' })).toBeInTheDocument()
  })

  it('evicts the least-recently-used diagram once cache exceeds MAX_MERMAID_SVG_CACHE', async () => {
    expect(MAX_MERMAID_SVG_CACHE).toBe(40)
    vi.useFakeTimers()
    try {
      // Populate diagram 0 and diagram 1 first.
      const code0 = 'graph TD\n  N0[Zero] --> Z'
      const code1 = 'graph TD\n  N1[One] --> Z'
      const mountAndFlush = async (code: string) => {
        const view = render(<MermaidDiagram code={code} />)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300)
        })
        view.unmount()
      }

      await mountAndFlush(code0)
      await mountAndFlush(code1)

      // Touch code0 so code0 becomes MORE recent than code1 (true LRU vs FIFO).
      const touch0 = render(<MermaidDiagram code={code0} />)
      expect(touch0.container.querySelector('.thread-diagram svg')).not.toBeNull()
      touch0.unmount()

      // Insert 39 more unique diagrams (total 41 > 40): code1 (oldest untouched) must be evicted, code0 stays hot!
      for (let i = 2; i <= MAX_MERMAID_SVG_CACHE; i++) {
        await mountAndFlush(`graph TD\n  N${i}[Node${i}] --> Z`)
      }

      mermaidRender.mockClear()
      const remount0 = render(<MermaidDiagram code={code0} />)
      expect(remount0.container.querySelector('.thread-diagram svg')).not.toBeNull()
      expect(mermaidRender).not.toHaveBeenCalled()
      remount0.unmount()

      const remount1 = render(<MermaidDiagram code={code1} />)
      expect(remount1.container.querySelector('.thread-diagram svg')).toBeNull()
      remount1.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
