// Frozen acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-196, PB-01·5, CA-1 and CA-2). Written by the
// planner; the executor must not edit it. Item: oxespace-ux-ag/POLISH-01-componentes-base.md #5, approved by MARCA.
// Contract (src/ui/Display.tsx, src/ui/Display.module.css): the retry action of ErrorState and OfflineState is the src/ui
// <Button variant="secondary" size="md"> (data-ui="button", data-variant="secondary", md emits no data-size) with the
// same words as today (ErrorState: retryLabel, default ui.tryAgain; OfflineState: ui.offline.retry); the raw
// <button class=errorRetry> and the .errorRetry rules are gone. A click or Enter calls onRetry once each. Without
// onRetry there is no button. The built app is checked by pb-01-5.spec.ts.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ErrorState, OfflineState } from '../../../src/ui/Display'
// ---- repository text and catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pbReadFile } from 'node:fs'
import { join as pbJoin } from 'node:path'

const pbRead = (rel: string): string => pbReadFile(pbJoin(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const pbCatalogs: Record<string, unknown> = {}
/** The English catalog text of `ns:key` (shared/locales/en/<ns>.json), so elements are found by what a person reads. */
function cat(ns: string, key: string, vars: Record<string, string | number> = {}): string {
  pbCatalogs[ns] ??= JSON.parse(pbRead(`shared/locales/en/${ns}.json`))
  let node: unknown = pbCatalogs[ns]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the en ${ns} catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
}
afterEach(() => cleanup())

describe('PB-01·5 · "Try again" is the src/ui Button', () => {
  test('ErrorState and OfflineState retry with a secondary md Button, and the raw .errorRetry is gone', () => {
    render(<><ErrorState title="Could not load pull requests" onRetry={() => {}} /><OfflineState onRetry={() => {}} /></>)
    for (const name of [cat('common', 'ui.tryAgain'), cat('common', 'ui.offline.retry')]) {
      const button = screen.getByRole('button', { name })
      expect(button, name).toHaveAttribute('data-ui', 'button')
      expect(button, name).toHaveAttribute('data-variant', 'secondary')
      expect(button.getAttribute('data-size') ?? 'md', name).toBe('md')
    }
    expect(pbRead('src/ui/Display.module.css'), 'SOURCE-TEXT: no .errorRetry rule left').not.toMatch(/\.errorRetry\b/)
  })

  test('a click and Enter each call onRetry once; a custom retryLabel is kept', async () => {
    const onRetry = vi.fn()
    render(<ErrorState compact title="Could not list branches." onRetry={onRetry} retryLabel="Reload branches" />)
    const button = screen.getByRole('button', { name: 'Reload branches' })
    expect(button).toHaveAttribute('data-ui', 'button')
    await userEvent.click(button)
    expect(onRetry).toHaveBeenCalledTimes(1)
    button.focus()
    await userEvent.keyboard('{Enter}')
    expect(onRetry).toHaveBeenCalledTimes(2)
  })

  test('without onRetry there is no retry button', () => {
    render(<><ErrorState title="Something failed" /><OfflineState /></>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
