import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadTimelineItem } from '../../src/components/Threads/threadTimelineModel'
import { ThreadPromptNavigator } from '../../src/components/Threads/ThreadPromptNavigator'
import { ThreadMarkdown } from '../../src/components/Threads/ThreadMarkdown'

const ROOT = join(__dirname, '..', '..')
const readCss = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OXE-462 · OxeChat editorial prose, Obsidian Minimal Markdown & isolated sticky prompt', () => {
  it('styles inline code as a whisper-quiet tonal chip with zero border and zero underline', () => {
    const mdCss = readCss('src/components/Threads/ThreadMarkdown.css')
    const chromeCss = readCss('src/components/Threads/ThreadMessagesChrome.css')

    const inlineCode = mdCss.match(/\.thread-markdown :not\(pre\)\s*>\s*code\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(inlineCode).toMatch(/border:\s*(?:0|none)/)
    expect(inlineCode).toMatch(/text-decoration:\s*none/)
    expect(inlineCode).toMatch(/background:\s*color-mix\(in srgb,\s*var\(--tx-primary\)\s+7%,\s*transparent\)/)
    expect(inlineCode).toMatch(/border-radius:\s*var\(--radius-sm\)/)
    expect(inlineCode).toMatch(/font-family:\s*var\(--font-mono\)/)
    expect(inlineCode).toMatch(/color:\s*var\(--tx-primary\)/)

    const pathCode = mdCss.match(/\.thread-markdown \.path-link\s*>\s*code\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(pathCode).toMatch(/border:\s*(?:0|none)/)
    expect(pathCode).toMatch(/text-decoration:\s*none/)

    const pathLink = chromeCss.match(/\.thread-path-link\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(pathLink).toMatch(/text-decoration:\s*none/)

    const { container } = render(<ThreadMarkdown text={'Fixed `453`, `457`, and `#1240` cleanly.'} />)
    const codes = [...container.querySelectorAll('code')]
    expect(codes.map(node => node.textContent)).toEqual(['453', '457', '#1240'])
  })

  it('applies Obsidian Minimal Markdown typography: restrained headings, borderless vertical-rule-free tables, and clean code blocks', () => {
    const mdCss = readCss('src/components/Threads/ThreadMarkdown.css')
    const viewCss = readCss('src/components/Threads/ThreadView.css')

    // Centered editorial measure on prose children while keeping .thread-markdown max-width: 100% for wide block escape.
    expect(mdCss).toMatch(/\.thread-markdown\s*\{[^}]*max-width:\s*100%[^}]*line-height:\s*1\.6/)
    expect(mdCss).toMatch(/\.thread-markdown\s*>\s*:is\([^)]*p[^)]*\)\s*\{[^}]*max-width:\s*min\(100%,\s*var\(--thread-editorial-max,\s*var\(--measure-prose\)\)\)/)
    expect(viewCss).toMatch(/--thread-editorial-max:\s*max\(var\(--measure-prose\),\s*48rem\)/)

    // Restrained Minimal headings in both ThreadMarkdown.css and ThreadView.css reader scale.
    expect(mdCss).toMatch(/\.thread-markdown h1\s*\{[^}]*font-size:\s*1\.25em/)
    expect(mdCss).toMatch(/\.thread-markdown h2\s*\{[^}]*font-size:\s*1\.125em/)
    expect(mdCss).toMatch(/\.thread-markdown h3\s*\{[^}]*font-size:\s*1\.025em/)
    expect(mdCss).toMatch(/\.thread-markdown :is\(h4,\s*h5,\s*h6\)\s*\{[^}]*font-size:\s*0\.95em/)
    expect(viewCss).toMatch(/\.thread-view \.thread-markdown h1\s*\{[^}]*1\.25/)
    expect(viewCss).toMatch(/\.thread-view \.thread-markdown h2\s*\{[^}]*1\.125/)
    expect(viewCss).toMatch(/\.thread-view \.thread-markdown h3\s*\{[^}]*1\.025/)

    // Hairline blockquote with zero card background.
    const blockquote = mdCss.match(/\.thread-markdown blockquote\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(blockquote).toMatch(/border-left:\s*2px solid var\(--bd-default\)/)
    expect(blockquote).toMatch(/background:\s*transparent/)

    // Tables: zero vertical rules, --bd-subtle horizontal hairlines, muted th header, overflow-x: auto containment.
    const tableCells = mdCss.match(/\.thread-markdown :is\(th,\s*td\)\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(tableCells).toMatch(/border-left:\s*0/)
    expect(tableCells).toMatch(/border-right:\s*0/)
    expect(tableCells).toMatch(/border-bottom:\s*1px solid var\(--bd-subtle\)/)
    const tableHeader = mdCss.match(/\.thread-markdown th\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(tableHeader).toMatch(/color:\s*var\(--tx-secondary\)/)
    expect(tableHeader).toMatch(/font-weight:\s*var\(--weight-medium\)/)
    expect(mdCss).toMatch(/\.thread-table-scroll\s*\{[^}]*overflow-x:\s*auto/)

    // Code blocks: hairline --bd-subtle, --radius-lg, calm --surface-sunken pre with isolated horizontal scroll.
    const codeBlock = mdCss.match(/\.thread-code-block\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(codeBlock).toMatch(/border:\s*1px solid var\(--bd-subtle\)/)
    expect(codeBlock).toMatch(/border-radius:\s*var\(--radius-lg\)/)
    const codePre = mdCss.match(/\.thread-markdown \.thread-code-block pre\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(codePre).toMatch(/background:\s*var\(--surface-sunken\)/)
    expect(codePre).toMatch(/overflow-x:\s*auto/)
    expect(codePre).toMatch(/max-width:\s*100%/)

    // Borderless, cardless assistant messages.
    const assistant = viewCss.match(/\.thread-message-assistant\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(assistant).toMatch(/border:\s*0/)
    expect(assistant).toMatch(/background:\s*transparent/)
    expect(assistant).toMatch(/box-shadow:\s*none/)
  })

  it('isolates the sticky prompt with an opaque full-width canvas bar and clips horizontal timeline bleed', () => {
    const workbenchCss = readCss('src/components/Threads/ThreadWorkbench.css')
    const viewCss = readCss('src/components/Threads/ThreadView.css')

    // Sticky anchor sits on --layer-sticky with isolated stacking context.
    const anchor = workbenchCss.match(/\.thread-sticky-prompt-anchor\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(anchor).toMatch(/position:\s*sticky/)
    expect(anchor).toMatch(/z-index:\s*var\(--layer-sticky\)/)
    expect(anchor).toMatch(/isolation:\s*isolate/)

    // Full-width opaque canvas backing strip covers gutters on both sides.
    const backdrop = workbenchCss.match(/\.thread-sticky-prompt-anchor:has\(\.thread-sticky-prompt\)::before\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(backdrop).toMatch(/background:\s*var\(--surface-canvas\)/)
    expect(backdrop).toMatch(/left:\s*calc\(-1 \* var\(--thread-gutter/)
    expect(backdrop).toMatch(/right:\s*calc\(-1 \* var\(--thread-gutter/)

    const bar = workbenchCss.match(/\.thread-sticky-prompt-bar\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(bar).toMatch(/background:\s*var\(--surface-canvas\)/)
    expect(bar).toMatch(/border-bottom:\s*1px solid var\(--bd-subtle\)/)
    expect(bar).toMatch(/left:\s*calc\(-1 \* var\(--thread-gutter/)
    expect(bar).toMatch(/right:\s*calc\(-1 \* var\(--thread-gutter/)

    const pill = workbenchCss.match(/\.thread-view \.thread-sticky-prompt-bar \.thread-sticky-prompt\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(pill).toMatch(/width:\s*100%/)
    expect(pill).toMatch(/height:\s*var\(--control-md\)/)
    expect(pill).toMatch(/background:\s*var\(--surface-chrome\)/)
    expect(pill).toMatch(/border:\s*1px solid var\(--bd-subtle\)/)

    // Strict horizontal containment on timeline rows and shell command toggles prevents right/left protrusion.
    const rowRule = viewCss.match(/\.thread-virtual-row\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(rowRule).toMatch(/min-width:\s*0/)
    expect(rowRule).toMatch(/max-width:\s*100%/)
    expect(rowRule).toMatch(/overflow-x:\s*clip/)

    const turnRule = viewCss.match(/\.thread-virtual-turn\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(turnRule).toMatch(/min-width:\s*0/)
    expect(turnRule).toMatch(/max-width:\s*100%/)
    expect(turnRule).toMatch(/overflow-x:\s*clip/)

    const stepToggle = viewCss.match(/\.thread-step-toggle\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(stepToggle).toMatch(/max-width:\s*100%/)
    expect(stepToggle).toMatch(/overflow:\s*hidden/)

    // WCAG 2.4.11 scroll-padding-top clears the sticky prompt bar.
    expect(viewCss).toMatch(/\.thread-timeline\s*\{[^}]*scroll-padding-top:\s*var\(--space-12\)/)
  })

  it('renders ThreadPromptNavigator inside .thread-sticky-prompt-bar with data-testid="thread-sticky-prompt" when the active prompt scrolls out of view', () => {
    const scrollTo = vi.fn()
    const rows: ThreadTimelineItem[] = [
      {
        key: 'u1',
        turnId: 'turn-1',
        firstInTurn: true,
        lastInTurn: false,
        turnEvents: [],
        event: { type: 'message', id: 'u1', role: 'user', text: 'Audit PR #1240 and summarize\nSecond line' }
      },
      {
        key: 'a1',
        turnId: 'turn-1',
        firstInTurn: false,
        lastInTurn: true,
        turnEvents: [],
        event: { type: 'message', id: 'a1', role: 'assistant', text: 'Detailed response body' }
      }
    ]

    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const flushFrames = (): void => {
      while (frames.length) frames.shift()!(0)
    }

    function Harness() {
      const scrollRef = useRef<HTMLDivElement>(null)
      return (
        <div ref={scrollRef} className="thread-timeline">
          <div className="thread-sticky-prompt-anchor">
            <ThreadPromptNavigator rows={rows} scrollRef={scrollRef} scrollTo={scrollTo} />
          </div>
          <section data-turn-id="turn-1" className="is-turn-start">Prompt row</section>
          <section data-turn-id="turn-1">Answer row</section>
        </div>
      )
    }

    const { container } = render(<Harness />)
    const scroller = container.querySelector<HTMLElement>('.thread-timeline')!
    const [promptRow, answerRow] = [...container.querySelectorAll<HTMLElement>('[data-turn-id="turn-1"]')]

    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 700, left: 0, right: 1080, width: 1080, height: 600, x: 0, y: 100, toJSON: () => ({}) })
    vi.spyOn(promptRow, 'getBoundingClientRect').mockReturnValue({ top: -40, bottom: 80, left: 0, right: 1080, width: 1080, height: 120, x: 0, y: -40, toJSON: () => ({}) })
    vi.spyOn(answerRow, 'getBoundingClientRect').mockReturnValue({ top: 90, bottom: 500, left: 0, right: 1080, width: 1080, height: 410, x: 0, y: 90, toJSON: () => ({}) })

    act(() => {
      flushFrames()
      fireEvent.scroll(scroller)
      flushFrames()
    })

    const bar = container.querySelector<HTMLElement>('.thread-sticky-prompt-bar[data-ui="sticky-prompt-bar"]')
    expect(bar).not.toBeNull()
    const stickyButton = screen.getByTestId('thread-sticky-prompt')
    expect(bar!.contains(stickyButton)).toBe(true)
    expect(stickyButton).toHaveTextContent('Audit PR #1240 and summarize')
    expect(stickyButton.textContent).not.toContain('Second line')

    fireEvent.click(stickyButton)
    expect(scrollTo).toHaveBeenCalledWith(0)
  })
})
