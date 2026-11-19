import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'
import ptCode from '../../../shared/locales/pt-BR/code.json'
import { HttpCallsPanel } from '../../../src/components/HttpCalls/HttpCallsPanel'
import type { HttpAuditRow } from '../../../shared/types/http-audit'

const at = (hour: number, minute: number): number => {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

const makeRow = (id: number, overrides: Partial<HttpAuditRow> = {}): HttpAuditRow => ({
  id,
  at: at(14, 40),
  actor: { kind: 'thread', id: 't-1', name: 'Fix checkout', gone: false },
  workspaceId: 'ws-1',
  agent: 'claude-code',
  sourceKind: 'hook',
  tool: 'Bash',
  method: 'POST',
  scheme: 'https',
  host: 'api.prod.test',
  port: 443,
  pathTemplate: '/v1/charges/:id',
  queryKeys: [],
  headerNames: ['Content-Type'],
  hasBody: true,
  bodyBytes: 128,
  status: null,
  durationMs: null,
  insecure: true,
  plainHttpExternal: true,
  outputTruncated: false,
  production: true,
  commandRedacted: 'curl http://api.prod.test/v1/charges/1',
  ...overrides
})

function mockHttpAudit(impl: (query: Record<string, unknown>) => unknown) {
  const list = vi.fn(async (query: Record<string, unknown>) => impl(query))
  Object.assign(window, {
    oxe: {
      ...(window as unknown as { oxe?: object }).oxe,
      httpAudit: { list }
    }
  })
  return list
}

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-258 · PP-05.1 HttpCallsPanel pt-BR i18n, glossary error and narrow stacking', () => {
  test('in pt-BR every visible string and aria-label in HttpCallsPanel comes from code:httpCalls.* keys with no hardcoded English text', async () => {
    await changeLanguage('pt-BR')
    const row = makeRow(1, { sourceKind: 'rollout' })
    mockHttpAudit(() => ({
      rows: [row],
      cursor: null,
      hosts: [{ host: 'api.prod.test', count: 1, production: true }]
    }))

    render(<HttpCallsPanel workspaceId="ws-1" />)

    expect(await screen.findByRole('heading', { name: 'api.prod.test' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ptCode.httpCalls.all })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ptCode.httpCalls.errors })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ptCode.httpCalls.flagged })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: ptCode.httpCalls.filterPlaceholder })).toHaveAttribute(
      'placeholder',
      ptCode.httpCalls.filterPlaceholder
    )
    expect(screen.getByText(ptCode.httpCalls.production)).toBeInTheDocument()
    expect(screen.getByText(ptCode.httpCalls.notEncrypted)).toBeInTheDocument()
    expect(screen.getByText(ptCode.httpCalls.tlsNotChecked)).toBeInTheDocument()

    const rowBtn = screen.getByRole('button', { name: new RegExp(`Sem status`) })
    expect(rowBtn.getAttribute('aria-label')).not.toContain('No status')
    await userEvent.click(rowBtn)

    expect(screen.getByText(ptCode.httpCalls.readAfterTurn)).toBeInTheDocument()
    expect(screen.getByText(ptCode.httpCalls.productionCallout)).toBeInTheDocument()
    expect(screen.getByText(ptCode.httpCalls.plainHttpCallout)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ptCode.httpCalls.openConversation })).toBeInTheDocument()

    const bodyText = document.body.textContent ?? ''
    for (const forbidden of [
      'No status',
      'Not encrypted',
      'TLS not checked',
      'Read after the turn',
      'A production host.',
      'Sent without TLS to a host outside this computer.',
      'Open the conversation'
    ]) {
      expect(bodyText).not.toContain(forbidden)
    }

    cleanup()
    mockHttpAudit(() => ({ rows: [], cursor: null, hosts: [] }))
    render(<HttpCallsPanel workspaceId="ws-1" />)
    expect(await screen.findByText(ptCode.httpCalls.empty)).toBeInTheDocument()

    cleanup()
    mockHttpAudit(query => ({
      rows: query.filter ? [] : [row],
      cursor: null,
      hosts: query.filter ? [] : [{ host: 'api.prod.test', count: 1, production: true }]
    }))
    render(<HttpCallsPanel workspaceId="ws-1" />)
    await userEvent.type(await screen.findByRole('textbox', { name: ptCode.httpCalls.filterPlaceholder }), 'nope')
    expect(await screen.findByText(ptCode.httpCalls.emptyFiltered)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: ptCode.httpCalls.clearFilters })).toBeInTheDocument()
  })

  test('pt-BR httpCalls.error uses "Não foi possível ler o registro HTTP" instead of "Não deu para"', async () => {
    expect(ptCode.httpCalls.error).toBe('Não foi possível ler o registro HTTP')
    expect(ptCode.httpCalls.error).not.toMatch(/Não deu para/i)

    await changeLanguage('pt-BR')
    mockHttpAudit(() => {
      throw new Error('db locked')
    })

    render(<HttpCallsPanel workspaceId="ws-1" />)
    expect(await screen.findByText('Não foi possível ler o registro HTTP')).toBeInTheDocument()
  })

  test('[css] below 640 px container width .http-call-detail stacks under the list at 100% width, max-height 45% and border-top 1px solid var(--bd-default)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/HttpCalls/HttpCallsPanel.css'), 'utf8')
    expect(css).toMatch(/container-type\s*:\s*inline-size/)

    const match = css.match(/@container\s*\(\s*max-width\s*:\s*640px\s*\)\s*\{([\s\S]*)\}\s*$/)
    expect(match).not.toBeNull()
    const block = match![1]
    expect(block).toMatch(/\.http-calls-content[\s\S]*flex-direction\s*:\s*column/)
    expect(block).toMatch(/\.http-call-detail[\s\S]*width\s*:\s*100%/)
    expect(block).toMatch(/\.http-call-detail[\s\S]*max-height\s*:\s*45%/)
    expect(block).toMatch(/\.http-call-detail[\s\S]*border-left\s*:\s*none/)
    expect(block).toMatch(/\.http-call-detail[\s\S]*border-top\s*:\s*1px solid var\(--bd-default\)/)
  })
})
