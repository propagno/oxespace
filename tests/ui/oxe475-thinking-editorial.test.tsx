import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEvent } from '../../shared/types/thread'
import {
  extractActiveReasoningHeading,
  isNearReasoningBottom,
  REASONING_HEADING_MAX_CHARS,
  ThreadReasoning
} from '../../src/components/Threads/ThreadReasoning'
import {
  isThinkingStyle,
  THINKING_STYLE_DEFAULT,
  THINKING_STYLES,
  useThreadPrefs
} from '../../src/store/thread-prefs.store'

type Reasoning = Extract<ThreadEvent, { type: 'reasoning' }>

const ROOT = join(__dirname, '..', '..')
const readCss = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

function reasoningEvent(text: string, completedAt?: number): Reasoning {
  return {
    type: 'reasoning',
    id: 'r-oxe475',
    text,
    startedAt: 1_000,
    ...(completedAt !== undefined ? { completedAt } : {})
  }
}

function setScrollMetrics(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop?: number }
): void {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: metrics.scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: metrics.clientHeight })
  if (metrics.scrollTop !== undefined) {
    element.scrollTop = metrics.scrollTop
  }
}

beforeEach(() => {
  localStorage.clear()
  useThreadPrefs.setState({ thinkingStyle: THINKING_STYLE_DEFAULT })
  document.documentElement.removeAttribute('data-motion')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-motion')
  useThreadPrefs.setState({ thinkingStyle: THINKING_STYLE_DEFAULT })
})

describe('OXE-475 · extractActiveReasoningHeading', () => {
  it('extracts standalone bold and ATX headings and trims trailing punctuation/colons', () => {
    expect(extractActiveReasoningHeading('**Checking migration lock**')).toBe('Checking migration lock')
    expect(extractActiveReasoningHeading('**Checking migration lock:**')).toBe('Checking migration lock')
    expect(extractActiveReasoningHeading('**Checking migration lock**:')).toBe('Checking migration lock')
    expect(extractActiveReasoningHeading('**Checking migration lock...**')).toBe('Checking migration lock')
    expect(extractActiveReasoningHeading('__Inspecting WAL checkpoints:__')).toBe('Inspecting WAL checkpoints')
    expect(extractActiveReasoningHeading('### Analyzing auth:')).toBe('Analyzing auth')
    expect(extractActiveReasoningHeading('## **Checking `ThreadReasoning.tsx`** ##')).toBe('Checking ThreadReasoning.tsx')
  })

  it('tracks multi-heading progression and always returns the latest heading', () => {
    const step1 = '**Reading store schema**\nInspecting thread-prefs.store.ts.'
    expect(extractActiveReasoningHeading(step1)).toBe('Reading store schema')

    const step2 = `${step1}\n\n**Checking migration lock:**\nVerifying rollback ordering.`
    expect(extractActiveReasoningHeading(step2)).toBe('Checking migration lock')

    const step3 = `${step2}\n\n### Writing verification suite\nCovering preview auto-scroll.`
    expect(extractActiveReasoningHeading(step3)).toBe('Writing verification suite')
  })

  it('returns null for empty, plain text, inline bold, list items, unclosed bold, and fenced headings', () => {
    expect(extractActiveReasoningHeading('')).toBeNull()
    expect(extractActiveReasoningHeading('   \n\n  ')).toBeNull()
    expect(extractActiveReasoningHeading('Checking the config.\nNo markdown headings here.')).toBeNull()
    expect(extractActiveReasoningHeading('I need to inspect **auth.ts** and **session.ts**.')).toBeNull()
    expect(extractActiveReasoningHeading('**first** and **second**')).toBeNull()
    expect(extractActiveReasoningHeading('- **List item heading**: details')).toBeNull()
    expect(extractActiveReasoningHeading('**Unclosed streaming heading')).toBeNull()
    expect(extractActiveReasoningHeading('#475 issue reference without space')).toBeNull()
    expect(extractActiveReasoningHeading('****')).toBeNull()
    expect(extractActiveReasoningHeading('```md\n### Heading inside code fence\n**Bold inside fence**\n```')).toBeNull()
  })

  it('ignores headings inside fenced code blocks while keeping earlier real headings', () => {
    const text = [
      '**Analyzing auth**',
      '',
      '```bash',
      '### comment inside bash fence',
      '**not a heading**',
      '```',
      '',
      '~~~md',
      '## tilde fence heading',
      '~~~'
    ].join('\n')
    expect(extractActiveReasoningHeading(text)).toBe('Analyzing auth')
  })

  it('caps overly long headings cleanly with an ellipsis', () => {
    const longHeading = 'Checking the exceptionally detailed database migration lock semantics across concurrent SQLite WAL writers and readers'
    const extracted = extractActiveReasoningHeading(`**${longHeading}**`)
    expect(extracted).not.toBeNull()
    expect(extracted!.endsWith('…')).toBe(true)
    expect(extracted!.length).toBeLessThanOrEqual(REASONING_HEADING_MAX_CHARS)
  })
})

describe('OXE-475 · editorial Markdown rendering & active streaming subtitle', () => {
  const MARKDOWN_THOUGHT = [
    '**Checking migration lock**',
    '',
    'Inspecting `migrations.ts` before changing the **order**:',
    '',
    '- Verify WAL checkpoint safety',
    '- Confirm rollback path in `sqlite.ts`',
    '',
    '### Next step',
    '',
    'Run *targeted* verification.'
  ].join('\n')

  it('renders expanded reasoning with real Markdown (strong, code, ul/li, h3) and never leaks raw **bold** or `code`', async () => {
    const user = userEvent.setup()
    render(<ThreadReasoning event={reasoningEvent(MARKDOWN_THOUGHT, 7_000)} running={false} />)

    const block = screen.getByTestId('thread-reasoning') as HTMLDetailsElement
    expect(block.open).toBe(false)
    expect(within(block).queryByText('Checking migration lock')).toBeNull()

    const toggle = within(block).getByRole('button')
    await user.click(toggle)
    expect(block.open).toBe(true)

    const body = block.querySelector<HTMLElement>('.thread-reasoning-body.thread-reasoning-markdown')
    expect(body).not.toBeNull()
    expect(body!.classList.contains('thread-markdown')).toBe(true)

    const strongs = [...body!.querySelectorAll('strong')].map(node => node.textContent)
    expect(strongs).toEqual(['Checking migration lock', 'order'])

    const codes = [...body!.querySelectorAll('code')].map(node => node.textContent)
    expect(codes).toEqual(['migrations.ts', 'sqlite.ts'])

    const items = [...body!.querySelectorAll('ul > li')].map(node => node.textContent?.trim())
    expect(items).toEqual(['Verify WAL checkpoint safety', 'Confirm rollback path in sqlite.ts'])

    const h3 = body!.querySelector('h3')
    expect(h3?.textContent).toBe('Next step')

    expect(body!.textContent).not.toContain('**')
    expect(body!.textContent).not.toContain('`')
    expect(body!.textContent).not.toContain('###')
  })

  it('shows the active heading subtitle beside "Thinking…" while streaming, updates live, and hides it when done', () => {
    const { rerender } = render(
      <ThreadReasoning event={reasoningEvent('**Checking migration lock**\nReading schema.')} running />
    )

    const block = screen.getByTestId('thread-reasoning')
    expect(block.textContent).toContain('Thinking…')
    const subtitle = block.querySelector<HTMLElement>('[data-ui="reasoning-subtitle"]')
    expect(subtitle).not.toBeNull()
    expect(subtitle!.textContent).toBe('Checking migration lock')
    expect(subtitle!.getAttribute('title')).toBe('Checking migration lock')

    rerender(
      <ThreadReasoning
        event={reasoningEvent('**Checking migration lock**\nReading schema.\n\n### Analyzing auth\nInspecting JWT.')}
        running
      />
    )
    expect(block.querySelector('[data-ui="reasoning-subtitle"]')?.textContent).toBe('Analyzing auth')

    rerender(
      <ThreadReasoning
        event={reasoningEvent('**Checking migration lock**\nReading schema.\n\n### Analyzing auth\nInspecting JWT.', 6_000)}
        running={false}
      />
    )
    expect(block.querySelector('[data-ui="reasoning-subtitle"]')).toBeNull()
    expect(within(block).getByRole('button').textContent?.trim()).toBe('Thought for 5s')
  })

  it('omits the subtitle when streaming plain reasoning text with no headings', () => {
    render(<ThreadReasoning event={reasoningEvent('Just reading the config file carefully.')} running />)
    const block = screen.getByTestId('thread-reasoning')
    expect(block.textContent).toContain('Thinking…')
    expect(block.querySelector('[data-ui="reasoning-subtitle"]')).toBeNull()
  })

  it('renders crisp compact Markdown inside the streaming preview without 3-line truncation', () => {
    const multiLine = [
      '**Step 1: Inspect config**',
      '',
      'Line one with `alpha.ts`.',
      '',
      'Line two with `beta.ts`.',
      '',
      'Line three with `gamma.ts`.',
      '',
      'Line four with `delta.ts`.'
    ].join('\n')

    render(<ThreadReasoning event={reasoningEvent(multiLine)} running />)

    const preview = screen.getByTestId('thread-reasoning').querySelector<HTMLElement>('[data-ui="reasoning-preview"]')
    expect(preview).not.toBeNull()
    expect(preview!.querySelector('strong')?.textContent).toBe('Step 1: Inspect config')
    expect([...preview!.querySelectorAll('code')].map(node => node.textContent)).toEqual([
      'alpha.ts',
      'beta.ts',
      'gamma.ts',
      'delta.ts'
    ])
    // All paragraphs remain accessible inside the 160px scrollable preview instead of being sliced to the last 3 lines.
    expect(preview!.textContent).toContain('Line one')
    expect(preview!.textContent).toContain('Line four')
    expect(preview!.textContent).not.toContain('**')
  })
})

describe('OXE-475 · 160px auto-scroll preview & pause/resume', () => {
  it('evaluates proximity to the bottom edge cleanly', () => {
    expect(isNearReasoningBottom({ scrollTop: 240, clientHeight: 160, scrollHeight: 400 })).toBe(true)
    expect(isNearReasoningBottom({ scrollTop: 224, clientHeight: 160, scrollHeight: 400 })).toBe(true)
    expect(isNearReasoningBottom({ scrollTop: 223, clientHeight: 160, scrollHeight: 400 })).toBe(false)
    expect(isNearReasoningBottom({ scrollTop: 0, clientHeight: 160, scrollHeight: 90 })).toBe(true)
  })

  it('auto-scrolls smoothly as tokens arrive, pauses on manual scroll up, and resumes when back near bottom', () => {
    const { rerender } = render(<ThreadReasoning event={reasoningEvent('**Step 1**\nInitial thought')} running />)
    const preview = screen.getByTestId('thread-reasoning').querySelector<HTMLElement>('[data-ui="reasoning-preview"]')!
    expect(preview).not.toBeNull()

    const scrollTo = vi.fn(({ top }: { top?: number; behavior?: ScrollBehavior }) => {
      if (typeof top === 'number') preview.scrollTop = top
    })
    Object.defineProperty(preview, 'scrollTo', { configurable: true, value: scrollTo })

    // First overflow batch: auto-scrolls smoothly to bottom (400 - 160 = 240).
    setScrollMetrics(preview, { scrollHeight: 400, clientHeight: 160, scrollTop: 0 })
    rerender(<ThreadReasoning event={reasoningEvent('**Step 1**\nInitial thought\n\nSecond paragraph')} running />)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 240, behavior: 'smooth' })
    expect(preview.scrollTop).toBe(240)
    fireEvent.scroll(preview)

    // User manually scrolls up to read earlier reasoning.
    fireEvent.wheel(preview, { deltaY: -120 })
    preview.scrollTop = 60
    fireEvent.scroll(preview)

    // New tokens stream in: auto-scroll MUST stay paused.
    setScrollMetrics(preview, { scrollHeight: 520, clientHeight: 160 })
    rerender(
      <ThreadReasoning event={reasoningEvent('**Step 1**\nInitial thought\n\nSecond paragraph\n\nThird paragraph')} running />
    )
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(preview.scrollTop).toBe(60)

    // User scrolls back near bottom (520 - 160 - 350 = 10 <= 16): auto-scroll resumes.
    preview.scrollTop = 350
    fireEvent.scroll(preview)

    setScrollMetrics(preview, { scrollHeight: 620, clientHeight: 160 })
    rerender(
      <ThreadReasoning
        event={reasoningEvent('**Step 1**\nInitial thought\n\nSecond paragraph\n\nThird paragraph\n\nFourth paragraph')}
        running
      />
    )
    expect(scrollTo).toHaveBeenCalledTimes(2)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 460, behavior: 'smooth' })
    expect(preview.scrollTop).toBe(460)

    // Respects reduced motion preference with behavior: 'auto'.
    document.documentElement.setAttribute('data-motion', 'reduce')
    setScrollMetrics(preview, { scrollHeight: 700, clientHeight: 160 })
    rerender(
      <ThreadReasoning
        event={reasoningEvent('**Step 1**\nInitial thought\n\nSecond paragraph\n\nThird paragraph\n\nFourth paragraph\n\nFifth')}
        running
      />
    )
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 540, behavior: 'auto' })
  })

  it('keeps Obsidian Minimal tokens, 160px fade-masked preview, hairline rules, and zero raw color literals in ThreadReasoning.css', () => {
    const css = readCss('src/components/Threads/ThreadReasoning.css')
    const previewRule = css.match(/\.thread-reasoning-preview\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(previewRule).toMatch(/max-height:\s*160px/)
    expect(previewRule).toMatch(/overflow-y:\s*auto/)
    expect(previewRule).toMatch(/overflow-x:\s*hidden/)
    expect(previewRule).toMatch(/mask-image:\s*linear-gradient\(/)
    expect(previewRule).not.toMatch(/line-clamp/)

    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(css).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch)\s*\(/i)
    for (const match of css.matchAll(/box-shadow\s*:\s*([^;]+)/g)) {
      expect(match[1].trim()).toBe('none')
    }
  })
})

describe('OXE-475 · thinkingStyle prop and thread-prefs store', () => {
  it('defaults thinkingStyle to "preview" and validates persisted values in useThreadPrefs', () => {
    expect(THINKING_STYLES).toEqual(['preview', 'collapsed', 'expanded'])
    expect(THINKING_STYLE_DEFAULT).toBe('preview')
    expect(isThinkingStyle('preview')).toBe(true)
    expect(isThinkingStyle('collapsed')).toBe(true)
    expect(isThinkingStyle('expanded')).toBe(true)
    expect(isThinkingStyle('bogus')).toBe(false)

    expect(useThreadPrefs.getState().thinkingStyle).toBe('preview')
    useThreadPrefs.getState().setThinkingStyle('collapsed')
    expect(useThreadPrefs.getState().thinkingStyle).toBe('collapsed')
    useThreadPrefs.getState().setThinkingStyle('expanded')
    expect(useThreadPrefs.getState().thinkingStyle).toBe('expanded')
    // Invalid input safely resets to factory default.
    useThreadPrefs.getState().setThinkingStyle('invalid' as never)
    expect(useThreadPrefs.getState().thinkingStyle).toBe('preview')
  })

  it('respects "collapsed" style while streaming and done, allowing manual expansion', async () => {
    const user = userEvent.setup()
    render(<ThreadReasoning event={reasoningEvent('**Checking lock**\nDetails here')} running thinkingStyle="collapsed" />)

    const block = screen.getByTestId('thread-reasoning') as HTMLDetailsElement
    expect(block.open).toBe(false)
    expect(block).toHaveAttribute('data-thinking-style', 'collapsed')
    expect(block.querySelector('[data-ui="reasoning-subtitle"]')?.textContent).toBe('Checking lock')
    expect(block.querySelector('[data-ui="reasoning-preview"]')).toBeNull()

    await user.click(within(block).getByRole('button'))
    expect(block.open).toBe(true)
    expect(block.querySelector('[data-ui="reasoning-preview"]')).not.toBeNull()
  })

  it('respects "expanded" style both while streaming and when completed, without 160px preview cap', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <ThreadReasoning event={reasoningEvent('**Checking lock**\nFull markdown body with `code`.')} running thinkingStyle="expanded" />
    )

    const block = screen.getByTestId('thread-reasoning') as HTMLDetailsElement
    expect(block.open).toBe(true)
    expect(block).toHaveAttribute('data-thinking-style', 'expanded')
    expect(block.querySelector('[data-ui="reasoning-preview"]')).toBeNull()
    expect(block.querySelector('.thread-reasoning-body.thread-reasoning-markdown')).not.toBeNull()

    rerender(
      <ThreadReasoning event={reasoningEvent('**Checking lock**\nFull markdown body with `code`.', 5_000)} running={false} thinkingStyle="expanded" />
    )
    expect(block.open).toBe(true)
    expect(block.querySelector('.thread-reasoning-body code')?.textContent).toBe('code')

    await user.click(within(block).getByRole('button'))
    expect(block.open).toBe(false)
  })

  it('follows useThreadPrefs().thinkingStyle when the thinkingStyle prop is omitted', () => {
    useThreadPrefs.setState({ thinkingStyle: 'collapsed' })
    render(<ThreadReasoning event={reasoningEvent('**Checking lock**\nBody')} running />)
    const block = screen.getByTestId('thread-reasoning') as HTMLDetailsElement
    expect(block.open).toBe(false)
    expect(block).toHaveAttribute('data-thinking-style', 'collapsed')
  })

  it('toggles cleanly when clicking anywhere on the <summary> row without double-toggling the inner button (OXE-492)', async () => {
    const user = userEvent.setup()
    render(<ThreadReasoning event={reasoningEvent('**Checking lock**\nDetailed steps.', 4_000)} running={false} />)
    const block = screen.getByTestId('thread-reasoning') as HTMLDetailsElement
    const summary = block.querySelector('summary')!
    const button = within(block).getByRole('button')

    expect(block.open).toBe(false)
    // Clicking the <summary> row outside the inner button opens it.
    await user.click(summary)
    expect(block.open).toBe(true)
    // Clicking the <summary> row again closes it.
    await user.click(summary)
    expect(block.open).toBe(false)
    // Clicking the inner button opens it once (no double-toggle from bubbling to <summary>).
    await user.click(button)
    expect(block.open).toBe(true)
    await user.click(button)
    expect(block.open).toBe(false)
  })
})
