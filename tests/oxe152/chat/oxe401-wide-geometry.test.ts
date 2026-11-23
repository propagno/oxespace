import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

describe('OXE-401 · OxeChat wide geometry, Light WCAG AA contrast and CSS hygiene', () => {
  test('emits --measure-chat: 1080px in tokens.generated.css from scales.ts', () => {
    const scales = read('src/design/tokens/scales.ts')
    expect(scales).toMatch(/'measure-chat':\s*'1080px'/)
    const tokens = read('src/styles/tokens.generated.css')
    expect(tokens).toMatch(/--measure-chat:\s*1080px;/)
  })

  test('removes the 72ch prose choke and undefined CSS variables in ThreadMarkdown.css and ThreadView.css', () => {
    const markdownCss = read('src/components/Threads/ThreadMarkdown.css')
    const viewCss = read('src/components/Threads/ThreadView.css')

    expect(markdownCss).not.toMatch(/max-width:\s*72ch/)
    expect(markdownCss).not.toContain('--radius-xs')
    expect(viewCss).not.toContain('--radius-xs')
    expect(viewCss).not.toContain('--transition-fast')
    expect(viewCss).not.toContain('--thread-reading-width')
  })

  test('unifies reading and composer columns on --thread-canvas-max while preserving --measure-chat fallback', () => {
    const viewCss = read('src/components/Threads/ThreadView.css')
    expect(viewCss).toMatch(/\.thread-reading-column\s*\{[^}]*max-width:\s*var\(--thread-canvas-max,\s*var\(--measure-chat\)\)/)
    expect(viewCss).toMatch(/\.thread-workbench \.thread-timeline > \.thread-reading-column\[data-ui="chat-column"\]\s*\{[^}]*max-width:\s*var\(--thread-canvas-max,\s*var\(--measure-chat\)\)/)
    expect(viewCss).toMatch(/\.thread-composer-column\s*\{[^}]*var\(--thread-canvas-max\)/)
  })

  test('uses --intent-warning-fg (never --intent-warning-solid) for warning text and accessible find highlight in ThreadView.css', () => {
    const viewCss = read('src/components/Threads/ThreadView.css')
    expect(viewCss).not.toMatch(/(?:^|[;{\s])color:\s*var\(--intent-warning-solid\)/m)
    expect(viewCss).toMatch(/color:\s*var\(--intent-warning-fg\)/)
    expect(viewCss).toMatch(/::highlight\(thread-find\)\s*\{[^}]*color:\s*var\(--tx-primary\)[^}]*background-color:\s*var\(--intent-warning-bg\)/)
  })

  test('keeps sticky prompt backdrop on --surface-canvas with bottom separation in ThreadWorkbench.css', () => {
    const workbenchCss = read('src/components/Threads/ThreadWorkbench.css')
    expect(workbenchCss).toMatch(/\.thread-sticky-prompt-anchor:has\(\.thread-sticky-prompt\)::before\s*\{[^}]*background:\s*var\(--surface-canvas\)/)
    expect(workbenchCss).toMatch(/\.thread-sticky-prompt-anchor\s*\{[^}]*margin-bottom:\s*var\(--space-2\)/)
  })

  test('enforces WCAG 2.5.8 >= 24px targets for attachment and shell-tab close buttons', () => {
    const viewCss = read('src/components/Threads/ThreadView.css')
    const attachMatch = viewCss.match(/\.thread-attachments button\s*\{([^}]+)\}/)
    expect(attachMatch?.[1]).toBeTruthy()
    expect(Number(attachMatch![1].match(/width:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(24)
    expect(Number(attachMatch![1].match(/height:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(24)

    const shellCloseMatch = viewCss.match(/\.thread-project-terminal \.thread-shell-tab-close\s*\{([^}]+)\}/)
    expect(shellCloseMatch?.[1]).toBeTruthy()
    expect(Number(shellCloseMatch![1].match(/width:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(24)
    expect(Number(shellCloseMatch![1].match(/height:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(24)
  })

  test('does not reserve vertical flow space for prompt actions at rest and reveals them on touch devices', () => {
    const chromeCss = read('src/components/Threads/ThreadMessagesChrome.css')
    expect(chromeCss).toMatch(/\.thread-view \.thread-prompt-actions\s*\{[^}]*position:\s*absolute/)
    expect(chromeCss).toMatch(/@media\s*\(hover:\s*none\)\s*\{[^}]*\.thread-prompt-actions\s*\{[^}]*opacity:\s*1/)
  })
})
