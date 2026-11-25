// Frozen acceptance test for 1.6.0 program 160-125 (Jira OXE-125, A3: CA-3). Written by the planner; the executor must
// not edit it. Contract: whatever tree the render worker sends, the renderer turns it into React elements with the same
// components and URL transform as today (D-02): a <script>, an inline handler (on*), a javascript: address or raw HTML
// never reaches the DOM, and PathLink, ExternalAnchor and the code block's Copy button are still there. The tree is the
// worker's own (parseThreadMarkdown), and a hostile tree built by hand is rendered as safely.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadMarkdown } from '../../../src/components/Threads/ThreadMarkdown'
import { installStubWorker, renderWorker } from './render-worker-stub'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

type Core = { parseThreadMarkdown: (text: string) => unknown }
async function loadCore(): Promise<Core | null> {
  const path = '../../../src/components/Threads/threadRenderCore'
  return await import(/* @vite-ignore */ path).catch(() => null) as Core | null
}

const HOSTILE = [
  '<script>window.__pwned = 1</script>',
  '',
  '<img src="x" onerror="window.__pwned = 2">',
  '',
  '[Unsafe](javascript:window.__pwned=3)',
  '',
  '<iframe src="https://example.com"></iframe>'
].join('\n')

/** No element, attribute or address that could run code. */
function assertInert(container: HTMLElement): void {
  expect(container.querySelector('script, iframe, object, embed, style')).toBeNull()
  for (const element of Array.from(container.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      expect(attribute.name.toLowerCase().startsWith('on'), `${element.tagName} ${attribute.name}`).toBe(false)
      expect(/^\s*javascript:/i.test(attribute.value), `${element.tagName} ${attribute.name}=${attribute.value}`).toBe(false)
    }
  }
  expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined()
}

/** Renders the text through the stub worker, answering with `tree` (the worker's own tree by default). */
async function throughWorker(text: string, tree?: unknown): Promise<HTMLElement> {
  installStubWorker()
  const { container } = render(<ThreadMarkdown text={text} />)
  const worker = renderWorker()
  expect(worker, 'the text went to the render worker').toBeDefined()
  const core = await loadCore()
  expect(core, 'src/components/Threads/threadRenderCore.ts exports parseThreadMarkdown').not.toBeNull()
  worker!.reply({ id: worker!.posted[0].id, tree: tree ?? core!.parseThreadMarkdown(text) })
  return container
}

describe('OXE-125 · A3 the worker output is rendered safely', () => {
  it('the worker output never runs a script, an on handler or a javascript URL', async () => {
    const container = await throughWorker(HOSTILE)
    await waitFor(() => expect(container.textContent).toContain('Unsafe'))
    assertInert(container)
    // A tree that did not come from the parser: raw HTML and handlers in it are not drawn either.
    cleanup(); vi.unstubAllGlobals()
    const forged = { type: 'root', children: [
      { type: 'raw', value: '<img src=x onerror="window.__pwned=4">' },
      { type: 'element', tagName: 'a', properties: { href: 'javascript:window.__pwned=5', onClick: 'window.__pwned=6' }, children: [{ type: 'text', value: 'forged' }] },
      { type: 'element', tagName: 'script', properties: {}, children: [{ type: 'text', value: 'window.__pwned=7' }] }
    ] }
    const second = await throughWorker('forged\n', forged)
    await waitFor(() => expect(second.textContent).toContain('forged'))
    assertInert(second)
  })

  it('PathLink, ExternalAnchor and Copy survive the worker', async () => {
    const text = 'Open `src/app.ts`, read [the docs](https://example.com/docs).\n\n```ts\nconst a = 1\n```\n'
    // The synchronous path (no Worker), as today, with a conversation so the path is a PathLink: the reference DOM.
    const plain = render(<ThreadMarkdown text={text} threadId="thread-1" />)
    await waitFor(() => expect(plain.container.querySelector('.thread-code-block')).not.toBeNull())
    const reference = plain.container.innerHTML
    cleanup()
    installStubWorker()
    const { container } = render(<ThreadMarkdown text={`${text}\n`} threadId="thread-1" />)
    const worker = renderWorker()
    expect(worker, 'the text went to the render worker').toBeDefined()
    const core = await loadCore()
    expect(core, 'src/components/Threads/threadRenderCore.ts exports parseThreadMarkdown').not.toBeNull()
    worker!.reply({ id: worker!.posted[0].id, tree: core!.parseThreadMarkdown(`${text}\n`) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy())
    expect(screen.getByRole('link', { name: /the docs/ })).toBeTruthy()
    // PathLink, ExternalAnchor and the code block are the same elements the synchronous path draws.
    await waitFor(() => expect(container.innerHTML).toBe(reference))
  })
})
