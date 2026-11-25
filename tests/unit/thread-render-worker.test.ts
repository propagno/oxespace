import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultUrlTransform } from 'react-markdown'
import { parseThreadMarkdown } from '../../src/components/Threads/threadRenderCore'
import { sanitizeThreadHast } from '../../src/components/Threads/threadMarkdownParse'
import {
  getCachedThreadTree,
  requestThreadTree,
  resetThreadRenderClientForTest
} from '../../src/components/Threads/threadRenderClient'
import { installStubWorker, renderWorker, StubWorker } from '../oxe160/oxe125/render-worker-stub'

afterEach(() => {
  resetThreadRenderClientForTest()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('OXE-125 · threadRenderCore & sanitizeThreadHast', () => {
  it('precomputes syntax tokens, diff tokens, language names and KaTeX HTML in hast node data', () => {
    const md = [
      'Inline $a_1 + b_2$ and broken $\\frac{a}{$.',
      '',
      '```ts',
      'const count: number = 42',
      '```',
      '',
      '```diff',
      '- old',
      '+ new',
      '```',
      '',
      '$$',
      'E = mc^2',
      '$$'
    ].join('\n')

    const tree = parseThreadMarkdown(md)
    expect(tree.type).toBe('root')
    const serialized = JSON.stringify(tree)
    expect(serialized).toContain('"threadLanguageName":"TypeScript"')
    expect(serialized).toContain('"kind":"keyword"')
    expect(serialized).toContain('"threadLanguageName":"Diff"')
    expect(serialized).toContain('"kind":"added"')
    expect(serialized).toContain('"kind":"removed"')
    expect(serialized).toContain('"threadMathHtml":"<span class=\\"katex\\">')
    expect(serialized).toContain('"threadMathHtml":null')
  })

  it('drops raw nodes, executable tags, on* handlers, javascript URLs and invalid data tokens', () => {
    const hostile = {
      type: 'root',
      children: [
        { type: 'raw', value: '<script>alert(1)</script>' },
        { type: 'element', tagName: 'script', properties: {}, children: [{ type: 'text', value: 'x' }] },
        { type: 'element', tagName: 'iframe', properties: { src: 'https://example.com' }, children: [] },
        {
          type: 'element',
          tagName: 'a',
          properties: { href: 'javascript:alert(1)', onClick: 'alert(2)', onerror: 'alert(3)', title: 'ok' },
          children: [{ type: 'text', value: 'link' }]
        },
        {
          type: 'element',
          tagName: 'code',
          properties: {},
          children: [{ type: 'text', value: 'x' }],
          data: { threadTokens: [{ text: 'x', kind: 'injected" onclick="alert(1)' }], threadLanguageName: 'TS' }
        }
      ]
    }
    const clean = sanitizeThreadHast(hostile, url => defaultUrlTransform(url))
    expect(clean.children).toHaveLength(2)
    const link = clean.children[0]
    expect(link.type).toBe('element')
    if (link.type === 'element') {
      expect(link.tagName).toBe('a')
      expect(link.properties.href).toBe('')
      expect(link.properties.title).toBe('ok')
      expect('onClick' in link.properties).toBe(false)
      expect('onerror' in link.properties).toBe(false)
    }
    const code = clean.children[1]
    expect(code.type).toBe('element')
    if (code.type === 'element') {
      expect(code.data?.threadTokens).toBeUndefined()
      expect(code.data?.threadLanguageName).toBe('TS')
    }
  })
})

describe('OXE-125 · threadRenderClient worker singleton, deduplication and LRU', () => {
  it('reuses one worker, deduplicates in-flight requests and caches up to 300 entries in LRU order', () => {
    installStubWorker()
    const first = vi.fn()
    const second = vi.fn()
    requestThreadTree('hello **world**', first)
    requestThreadTree('hello **world**', second)
    expect(StubWorker.all).toHaveLength(1)
    const worker = renderWorker()!
    expect(worker.posted).toHaveLength(1)

    const tree = parseThreadMarkdown('hello **world**')
    worker.reply({ id: worker.posted[0].id, tree })
    expect(first).toHaveBeenCalledWith(tree)
    expect(second).toHaveBeenCalledWith(tree)
    expect(getCachedThreadTree('hello **world**')).toBe(tree)

    // Fill cache past 300 entries and verify oldest entry is evicted.
    for (let i = 0; i < 305; i++) {
      const text = `entry-${i}`
      requestThreadTree(text, () => undefined)
      const last = worker.posted.at(-1)!
      worker.reply({ id: last.id, tree: { type: 'root', children: [{ type: 'text', value: text }] } })
    }
    expect(getCachedThreadTree('hello **world**')).toBeUndefined()
    expect(getCachedThreadTree('entry-0')).toBeUndefined()
    expect(getCachedThreadTree('entry-304')).toBeDefined()
  })

  it('falls back synchronously when Worker construction throws', () => {
    vi.stubGlobal('Worker', class BrokenWorker {
      constructor() { throw new Error('blocked') }
    })
    const received = vi.fn()
    requestThreadTree('**fallback**', received)
    expect(received).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(received.mock.calls[0][0])).toContain('"tagName":"strong"')
  })
})
