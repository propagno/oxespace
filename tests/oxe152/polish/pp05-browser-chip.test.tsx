// Acceptance test for 1.5.2 Polimento · OxeCode painéis (Jira OXE-263, PP-05·7, CA-1 and CA-2).
import { act, cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { AgentBrowserChrome } from '../../../src/components/WebPreview/AgentBrowserChrome'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

interface CssRule {
  selector: string
  decls: Record<string, string>
}

function parseRules(css: string): CssRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  let i = 0
  while (i < clean.length) {
    const open = clean.indexOf('{', i)
    if (open === -1) break
    let depth = 1
    let close = open + 1
    for (; close < clean.length && depth > 0; close++) {
      if (clean[close] === '{') depth++
      else if (clean[close] === '}') depth--
    }
    const head = clean.slice(i, open).trim()
    const body = clean.slice(open + 1, close - 1)
    i = close
    if (head.startsWith('@')) continue
    const decls: Record<string, string> = {}
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      const prop = part.slice(0, colon).trim().toLowerCase()
      const val = part.slice(colon + 1).trim()
      if (prop) decls[prop] = val
    }
    for (const sel of head.split(',').map((s) => s.trim()).filter(Boolean)) {
      rules.push({ selector: sel, decls })
    }
  }
  return rules
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OXE-263 · PP-05·7 Agent browser permission chip in --attn amber and 24 px controls', () => {
  test('[css] .agent-browser-scope-chip[data-tone="attn"] uses --attn-bg, --attn-border and --attn-fg tokens', async () => {
    const listeners: Array<(event: Record<string, unknown>) => void> = []
    Object.assign(window, {
      oxe: {
        ...(window as unknown as { oxe?: object }).oxe,
        browserPreview: {
          onEvent: vi.fn((cb: (event: Record<string, unknown>) => void) => {
            listeners.push(cb)
            return () => undefined
          }),
          revokeGrant: vi.fn(async () => undefined)
        }
      }
    })

    render(<AgentBrowserChrome ownerKey="code:ws-1" tabId="tab-1" agentName="Claude" />)
    act(() => {
      for (const listener of listeners) {
        listener({
          ownerKey: 'code:ws-1',
          tabId: 'tab-1',
          type: 'grant',
          grant: { previewSessionId: 'ps-1', origin: 'https://example.org', scope: 'action', grantedAt: 1 }
        })
      }
    })

    const chip = await screen.findByText('Asks each time')
    expect(chip.getAttribute('data-tone')).toBe('attn')

    const rules = parseRules(read('src/components/WebPreview/AgentBrowserChrome.css'))
    const attnRule = rules.find((r) => /\.agent-browser-scope-chip\[data-tone=['"]attn['"]\]/.test(r.selector))
    expect(attnRule).toBeDefined()
    expect(attnRule?.decls.background).toBe('var(--attn-bg)')
    expect(attnRule?.decls['border-color']).toBe('var(--attn-border)')
    expect(attnRule?.decls.color).toBe('var(--attn-fg)')
    expect(JSON.stringify(attnRule?.decls)).not.toContain('--intent-warning')
  })

  test('[css] browser scope chip, steps and interactive chips have min-height var(--control-sm)', () => {
    const rules = parseRules(read('src/components/WebPreview/AgentBrowserChrome.css'))

    for (const selector of ['.agent-browser-scope-chip', '.agent-browser-step', '.agent-browser-chip']) {
      const rule = rules.find((r) => r.selector === selector)
      expect(rule, `missing rule for ${selector}`).toBeDefined()
      expect(rule?.decls['min-height']).toBe('var(--control-sm)')
      expect(rule?.decls.height).toBeUndefined()
    }
  })
})
