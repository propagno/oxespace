import { Suspense, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { i18n, initI18n, useNamespace } from '../src/i18n'

/**
 * A lazy view's first render waits for its catalog with `use`. React replays a component that suspended; the hooks
 * after `useNamespace` must line up between the attempt and the replay, or React throws #467 and recovers with #520
 * (the OxePost e2e failure on Windows). The root renders outside act, as in the app, so React really replays.
 */
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = false })
afterEach(() => { document.body.innerHTML = '' })

function Probe(): ReactElement {
  useNamespace('post')
  const [count] = useState(1)
  return <p>{i18n.t('post:view.loading')} {count}</p>
}

describe('useNamespace', () => {
  it('suspends until the catalog arrives and renders once, with no recoverable error', async () => {
    await initI18n()
    for (const language of ['en', 'pt-BR']) i18n.removeResourceBundle(language, 'post')
    const recoverable = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host, { onRecoverableError: recoverable })
    root.render(<Suspense fallback={<p>waiting</p>}><Probe /></Suspense>)
    await vi.waitFor(() => expect(host.textContent).toBe('Loading OxePost 1'))
    expect(recoverable).not.toHaveBeenCalled()
    // Rendering again with the catalog in place never suspends and keeps the same hooks.
    root.render(<Suspense fallback={<p>waiting</p>}><Probe /></Suspense>)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(host.textContent).toBe('Loading OxePost 1')
    expect(recoverable).not.toHaveBeenCalled()
    root.unmount()
  })
})
