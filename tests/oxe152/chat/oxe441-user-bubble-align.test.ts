import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

describe('OXE-441 · OxeChat right-aligned user prompt bubble', () => {
  test('aligns .thread-message-user flush right with bounded fit-content geometry', () => {
    const css = read('src/components/Threads/ThreadMessagesChrome.css')
    const bubble = css.match(/\.thread-view \.thread-message-user\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(bubble).toMatch(/width:\s*fit-content;/)
    expect(bubble).toMatch(/max-width:\s*min\(78%,\s*640px\);/)
    expect(bubble).toMatch(/margin-left:\s*auto;/)
    expect(bubble).toMatch(/margin-right:\s*0;/)
    expect(bubble).toMatch(/border-radius:\s*var\(--radius-lg\);/)
  })

  test('expands the bubble when editing a prompt so the editor does not collapse to fit-content', () => {
    const css = read('src/components/Threads/ThreadMessagesChrome.css')
    const editing = css.match(/\.thread-view \.thread-message-user:has\(\.thread-prompt-editor\)\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(editing).toMatch(/width:\s*100%;/)
    expect(editing).toMatch(/max-width:\s*min\(85%,\s*680px\);/)
  })

  test('places prompt actions below the bubble right edge with a hover bridge so short messages stay readable', () => {
    const css = read('src/components/Threads/ThreadMessagesChrome.css')
    const actions = css.match(/\.thread-view \.thread-prompt-actions\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(actions).toMatch(/position:\s*absolute;/)
    expect(actions).toMatch(/top:\s*calc\(100%\s*\+\s*var\(--space-1\)\);/)
    expect(actions).toMatch(/right:\s*0;/)
    expect(actions).toMatch(/opacity:\s*0;/)
    expect(actions).toMatch(/pointer-events:\s*none;/)

    const bridge = css.match(/\.thread-view \.thread-prompt-actions::before\s*\{([^}]+)\}/)?.[1] ?? ''
    expect(bridge).toMatch(/bottom:\s*100%;/)
    expect(bridge).toMatch(/height:\s*var\(--space-1\);/)
  })

  test('keeps side chat user questions right-aligned', () => {
    const sideCss = read('src/components/Threads/side/ThreadSideChat.module.css')
    expect(sideCss).toMatch(/\.question\s*\{[^}]*align-self:\s*flex-end/)
  })

  test('enforces BRD-25.prompt.align on the right edge via inline-end-offset', () => {
    const brd25 = JSON.parse(read('src/design/targets/brd-25.json')) as {
      measures: Array<{ id: string; prop: string; of?: string; expect: Record<string, unknown>; state: string }>
    }
    const align = brd25.measures.find(m => m.id === 'BRD-25.prompt.align')
    expect(align).toMatchObject({
      prop: 'inline-end-offset',
      of: '[data-ui=chat-column]',
      expect: { px: 0 },
      state: 'enforced'
    })
    const spec = read('e2e/brand/brand-conformance.spec.ts')
    expect(spec).toContain("'inline-end-offset'")
    expect(spec).toContain('from.getBoundingClientRect().right - element.getBoundingClientRect().right')
  })
})
