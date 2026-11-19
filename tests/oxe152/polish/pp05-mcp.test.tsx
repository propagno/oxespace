// Acceptance test for 1.5.2 Polimento · OxeCode painéis (Jira OXE-265, PP-05·10, CA-1 to CA-3).
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { McpCatalog } from '../../../src/components/MCP/McpCatalog'
import type { McpServer } from '../../../shared/types/mcp'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

function hexLuminance(hex: string): number {
  const clean = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(clean.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [hexLuminance(a), hexLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

afterEach(() => {
  cleanup()
})

describe('OXE-265 · PP-05·10 MCP IconButton 24px, legible sync note and StatusSignal states', () => {
  test('.mcp-builtin-notice dismiss control is an IconButton size sm with a 24 px var(--control-sm) target', () => {
    const panelSrc = read('src/components/MCP/McpPanel.tsx')
    const noticeIdx = panelSrc.indexOf('className="mcp-builtin-notice"')
    expect(noticeIdx).toBeGreaterThan(-1)
    const noticeSnippet = panelSrc.slice(noticeIdx, noticeIdx + 420)
    expect(noticeSnippet).toContain('<IconButton')
    expect(noticeSnippet).toContain('size="sm"')
    expect(noticeSnippet).not.toMatch(/<button\b/)

    const mcpCss = read('src/styles/mcp.css')
    expect(mcpCss).not.toMatch(/\.mcp-builtin-notice\s+button/)
    expect(mcpCss).not.toMatch(/width:\s*18px/)
  })

  test('[css] .mcp-panel-sync-note uses --intent-info-fg on --intent-info-bg with at least 4.5:1 contrast in both themes', () => {
    const mcpCss = read('src/styles/mcp.css')
    const match = /\.mcp-panel-sync-note\s*\{([^}]+)\}/.exec(mcpCss)
    expect(match).not.toBeNull()
    const body = match![1]
    expect(body).toContain('background: var(--intent-info-bg)')
    expect(body).toContain('color: var(--intent-info-fg)')

    const tokens = read('src/styles/tokens.generated.css')
    const fgMatches = [...tokens.matchAll(/--intent-info-fg:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1])
    const bgMatches = [...tokens.matchAll(/--intent-info-bg:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1])
    expect(fgMatches.length).toBeGreaterThanOrEqual(2)
    expect(bgMatches.length).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < Math.min(fgMatches.length, bgMatches.length); i++) {
      expect(contrastRatio(fgMatches[i], bgMatches[i])).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('[css] MCP panel and catalog use sentence case, StatusSignal and --intent-* tokens with no hex, rgba or --dot-* literals', () => {
    const mcpCss = read('src/styles/mcp.css')
    const catalogCss = read('src/components/MCP/McpCatalog.css')
    const catalogTsx = read('src/components/MCP/McpCatalog.tsx')

    expect(mcpCss).not.toMatch(/text-transform:\s*uppercase/)
    expect(catalogCss).not.toMatch(/text-transform:\s*uppercase/)
    expect(mcpCss).not.toMatch(/rgba\(/)
    expect(catalogCss).not.toMatch(/rgba\(/)
    expect(`${mcpCss}\n${catalogCss}\n${catalogTsx}`).not.toMatch(/--dot-/)
    expect(catalogTsx).not.toMatch(/['"]#[0-9a-fA-F]{3,6}['"]/)

    expect(mcpCss).toContain('var(--intent-success-border)')
    expect(mcpCss).toContain('var(--intent-danger-border)')
    expect(catalogCss).toContain('var(--intent-success-bg)')
    expect(catalogCss).toContain('var(--intent-success-fg)')
    expect(catalogCss).toContain('var(--intent-warning-bg)')
    expect(catalogCss).toContain('var(--intent-warning-fg)')
    expect(catalogCss).toContain('var(--intent-danger-bg)')
    expect(catalogCss).toContain('var(--intent-danger-fg)')

    const server = {
      id: 'srv-github',
      name: 'GitHub',
      scope: 'global',
      enabled: true,
      health: 'healthy',
      config: { transport: 'http', url: 'https://api.githubcopilot.com/mcp/' }
    } as unknown as McpServer

    const { container } = render(
      <McpCatalog
        servers={[server]}
        query="github"
        busyId={null}
        onAdd={vi.fn()}
        onTest={vi.fn()}
      />
    )

    const signal = container.querySelector('.mcp-catalog-state [data-ui="status-signal"]')
    expect(signal).not.toBeNull()
    expect(signal?.getAttribute('data-state')).toBe('done')
    expect(screen.getByText('GitHub')).toBeInTheDocument()
  })
})
