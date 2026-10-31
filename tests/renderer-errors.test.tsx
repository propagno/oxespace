import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../src/components/common/ErrorBoundary'
import { firstComponent, fnv1a, IDENTIFIER, installRendererErrorReporting, rendererErrorReport, resetRendererErrorReports, stackFrames, stackHash, STACK_HASH, type RendererErrorBoundary, type RendererErrorInput } from '../src/lib/rendererErrors'

const ROOT = join(__dirname, '..')
const SECRET = String.raw`could not read C:\Users\dana\secrets\.env token=hunter2 SELECT * FROM payroll`
const STACK = [
  'Error: ' + SECRET,
  String.raw`    at renderCell (C:\Users\dana\oxespace\out\renderer\assets\index-abc.js:10:5)`,
  '    at async loadRows (file:///C:/Users/dana/oxespace/out/renderer/assets/index-abc.js:20:7)',
  '    at file:///C:/Users/dana/oxespace/out/renderer/assets/index-abc.js:30:9',
  '    at new Grid (http://localhost:5173/src/Grid.tsx:40:11)'
].join('\n')

let sent: RendererErrorInput[]
beforeEach(() => {
  sent = []
  resetRendererErrorReports()
  ;(window as unknown as { oxe: unknown }).oxe = { diagnostics: { reportRendererError: (input: RendererErrorInput) => { sent.push(input) } } }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function Boom({ token }: { token: string }): never {
  const error = new Error(`${SECRET} ${token}`)
  error.stack = STACK
  throw error
}
// The report module loads with the first error (src/lib/rendererErrorsBoot.ts): one turn lets it arrive.
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const noLeak = (payload: unknown): void => {
  const text = JSON.stringify(payload)
  for (const secret of ['hunter2', 'dana', 'Users', 'payroll', 'secrets', '.env', 'prop-value-xyz', 'index-abc', 'localhost', 'could not read']) expect(text, secret).not.toContain(secret)
}

describe('the report', () => {
  it('holds names and a stack hash, never the message, props or paths', async () => {
    render(<ErrorBoundary id="pane" label="the pane"><Boom token="prop-value-xyz" /></ErrorBoundary>)
    await settle()
    expect(sent).toHaveLength(1)
    expect(Object.keys(sent[0]).sort()).toEqual(['boundary', 'component', 'errorName', 'kind', 'stackHash'])
    expect(sent[0]).toMatchObject({ kind: 'boundary', boundary: 'pane', component: 'Boom', errorName: 'Error' })
    noLeak(sent[0])
  })

  it('keeps only identifiers that match the contract', () => {
    expect(IDENTIFIER.test('WorkspaceGrid')).toBe(true)
    expect(IDENTIFIER.test('Object.render')).toBe(true)
    for (const bad of ['', '9Lives', 'a b', 'C:\\x', 'x/y', 'a'.repeat(81), 'name<script>']) expect(IDENTIFIER.test(bad), bad).toBe(false)
    const odd = Object.assign(new Error('x'), { name: 'Not a name: C:\\Users\\dana' })
    expect(rendererErrorReport('uncaught', odd).errorName).toBe('Error')
    expect(rendererErrorReport('boundary', new TypeError('x'), { boundary: 'root', component: 'has space' })).not.toHaveProperty('component')
    expect(rendererErrorReport('unhandledRejection', 'a string with C:\\path')).toEqual({ kind: 'unhandledRejection', errorName: 'String' })
    expect(rendererErrorReport('unhandledRejection', undefined)).toEqual({ kind: 'unhandledRejection', errorName: 'Unknown' })
  })

  it('carries a C3 code only for a MainMessageError with a code-shaped value', () => {
    const main = Object.assign(new Error('Tradução'), { name: 'MainMessageError', code: 'approvals.refused.notPending' })
    expect(rendererErrorReport('uncaught', main)).toMatchObject({ errorName: 'MainMessageError', code: 'approvals.refused.notPending' })
    expect(rendererErrorReport('uncaught', Object.assign(new Error('x'), { code: 'ENOENT' }))).not.toHaveProperty('code')
    expect(rendererErrorReport('uncaught', Object.assign(new Error('x'), { name: 'MainMessageError', code: 'C:\\Users\\x' }))).not.toHaveProperty('code')
  })
})

describe('stack hash', () => {
  it('reads function and line:col, never a file', () => {
    expect(stackFrames(STACK)).toEqual(['renderCell@10:5', 'loadRows@20:7', '<anonymous>@30:9', 'Grid@40:11'])
  })
  it('is stable, hex and the same wherever the app is installed', () => {
    const elsewhere = STACK.replace(/dana/g, 'someone').replace(/C:\\Users/g, 'D:\\Apps').replace('localhost:5173', 'app')
    expect(stackHash(STACK)).toBe(stackHash(elsewhere))
    expect(stackHash(STACK)).toMatch(STACK_HASH)
    expect(stackHash(STACK)).not.toBe(stackHash(STACK.replace('10:5', '11:5')))
    expect(stackHash(undefined)).toBeUndefined()
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('a')).toBe('e40c292c')
  })
  it('names the first component of a React component stack', () => {
    expect(firstComponent('\n    at TerminalView (http://x/a.js:1:1)\n    at ErrorBoundary')).toBe('TerminalView')
    expect(firstComponent('\n    in WorkspaceGrid (created by App)')).toBe('WorkspaceGrid')
    expect(firstComponent(null)).toBeUndefined()
  })
})

describe('boundaries', () => {
  const ids: RendererErrorBoundary[] = ['root', 'window', 'conversations', 'mode-view', 'workspace-grid', 'workspace-panel', 'pane', 'terminal']
  it.each(ids)('%s sends its id', async id => {
    render(<ErrorBoundary id={id} label="x"><Boom token="prop-value-xyz" /></ErrorBoundary>)
    await settle()
    expect(sent.at(-1)).toMatchObject({ kind: 'boundary', boundary: id })
  })
  it('a view boundary names the view', async () => {
    render(<ErrorBoundary id="mode-view" component="OxeQuery" label="OxeQuery"><Boom token="t" /></ErrorBoundary>)
    await settle()
    expect(sent.at(-1)).toMatchObject({ boundary: 'mode-view', component: 'OxeQuery' })
  })
  it('every boundary in the app carries its id', () => {
    const expected: Array<[string, RendererErrorBoundary[]]> = [
      ['src/main.tsx', ['root']], ['src/App.tsx', ['conversations', 'window']], ['src/components/Navigation/ModeViews.tsx', ['mode-view']],
      ['src/components/Workspace/WorkspaceSurface.tsx', ['workspace-grid', 'workspace-panel']], ['src/components/Grid/WorkspaceGrid.tsx', ['pane']],
      ['src/components/Grid/WorkspaceSplitGrid.tsx', ['pane']], ['src/components/Panes/TerminalPane.tsx', ['terminal']]
    ]
    for (const [file, wanted] of expected) {
      const found = [...readFileSync(join(ROOT, file), 'utf8').matchAll(/<ErrorBoundary\b[^>]*\bid="([^"]+)"/g)].map(match => match[1])
      expect(found, file).toEqual(wanted)
    }
  })
  it('a failing or missing bridge never throws', () => {
    ;(window as unknown as { oxe: unknown }).oxe = { diagnostics: { reportRendererError: () => { throw new Error('bridge down') } } }
    expect(() => render(<ErrorBoundary id="pane" label="x"><Boom token="t" /></ErrorBoundary>)).not.toThrow()
    ;(window as unknown as { oxe: unknown }).oxe = {}
    resetRendererErrorReports()
    expect(() => render(<ErrorBoundary id="terminal" label="x"><Boom token="t" /></ErrorBoundary>)).not.toThrow()
  })
})

describe('errors nothing caught', () => {
  it('uncaught errors and unhandled rejections are reported without a boundary', async () => {
    installRendererErrorReporting()
    installRendererErrorReporting()
    const error = new RangeError(SECRET)
    error.stack = STACK
    window.dispatchEvent(new ErrorEvent('error', { error, message: SECRET }))
    const rejection = Object.assign(new Event('unhandledrejection'), { reason: Object.assign(new Error(SECRET), { name: 'AbortError' }) })
    window.dispatchEvent(rejection)
    await settle()
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({ kind: 'uncaught', errorName: 'RangeError' })
    expect(sent[1]).toMatchObject({ kind: 'unhandledRejection', errorName: 'AbortError' })
    for (const report of sent) { expect(report).not.toHaveProperty('boundary'); noLeak(report) }
  })
  it('sends the same crash once a minute', async () => {
    const crash = (): Error => Object.assign(new Error('x'), { stack: STACK })
    window.dispatchEvent(new ErrorEvent('error', { error: crash() }))
    window.dispatchEvent(new ErrorEvent('error', { error: crash() }))
    await settle()
    expect(sent).toHaveLength(1)
    const other = new Error('y')
    other.stack = STACK.replace('10:5', '12:5')
    window.dispatchEvent(new ErrorEvent('error', { error: other }))
    await settle()
    expect(sent).toHaveLength(2)
  })
})
