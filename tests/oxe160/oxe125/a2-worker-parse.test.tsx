// Frozen acceptance test for 1.6.0 program 160-125 (Jira OXE-125, A2: CA-2's parse in the worker). Written by the
// planner; the executor must not edit it. On main b3491f620 ThreadMarkdown parses Markdown (react-markdown, remark-gfm),
// highlights code and draws formulas on the renderer's main thread, for every mounted row. Contract (D-01..D-04 of the
// spec): a settled answer's text goes to the render worker, `new Worker(new URL('…/threadRender.worker.ts',
// import.meta.url), { type: 'module' })`, as `{ id, text }`; the worker answers `{ id, tree }` with the tree that
// `parseThreadMarkdown(text)` (src/components/Threads/threadRenderCore.ts) builds; until the answer the row shows the
// text plainly (no table yet); with the answer it draws the same DOM as the synchronous path that runs when there is
// no Worker (jsdom, tests), so nothing a reader sees changes.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadMarkdown } from '../../../src/components/Threads/ThreadMarkdown'
import { installStubWorker, renderWorker, RICH_ANSWER } from './render-worker-stub'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

type Core = { parseThreadMarkdown: (text: string) => unknown }
/** The worker's pure core; a missing module fails the assertion below, not the file's import. */
async function loadCore(): Promise<Core> {
  const path = '../../../src/components/Threads/threadRenderCore'
  const core = await import(/* @vite-ignore */ path).catch(() => null) as Core | null
  expect(core, 'src/components/Threads/threadRenderCore.ts exports parseThreadMarkdown').not.toBeNull()
  expect(typeof core!.parseThreadMarkdown).toBe('function')
  return core!
}

/** Lazy chunks (the highlighter, KaTeX) settle after the first paint: the DOM is compared once both are in. */
async function settled(container: HTMLElement): Promise<string> {
  await waitFor(() => {
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(container.querySelector('code .tk-added')).not.toBeNull()
  }, { timeout: 5_000 })
  return container.innerHTML
}

describe('OXE-125 · A2 the answer is parsed in the render worker', () => {
  it('parseThreadMarkdown turns GFM, code, math and a diff into a tree', async () => {
    const core = await loadCore()
    const tree = core.parseThreadMarkdown(RICH_ANSWER) as { type?: string; children?: unknown[] }
    expect(tree.type).toBe('root')
    expect(tree.children?.length).toBeGreaterThan(0)
    const text = JSON.stringify(tree)
    expect(text).toContain('"tagName":"table"')
    expect(text).toContain('const total')
    expect(text).toContain('new line')
    expect(text).toContain('x^2')
  })

  it('ThreadMarkdown parses Markdown, code, math and diffs through the render worker', async () => {
    const core = await loadCore().catch(() => null)
    const plain = render(<ThreadMarkdown text={RICH_ANSWER} />)
    const expected = await settled(plain.container)
    cleanup()

    installStubWorker()
    const { container } = render(<ThreadMarkdown text={`${RICH_ANSWER}\n`} />)
    const worker = renderWorker()
    expect(worker, 'the text went to the render worker').toBeDefined()
    expect(worker!.posted).toHaveLength(1)
    expect(worker!.posted[0]).toMatchObject({ text: `${RICH_ANSWER}\n` })
    expect(typeof worker!.posted[0].id).toBe('number')
    // Until the worker answers, the row shows the text plainly, not a half-parsed answer.
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('const total: number = 42')

    expect(core, 'the worker core exists').not.toBeNull()
    worker!.reply({ id: worker!.posted[0].id, tree: core!.parseThreadMarkdown(`${RICH_ANSWER}\n`) })
    expect(await settled(container)).toBe(expected)
    expect(screen.getByRole('table')).toBeTruthy()
  })
})
