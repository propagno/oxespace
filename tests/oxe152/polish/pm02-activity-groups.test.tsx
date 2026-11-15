// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-247, PM-02·10, CA-1 and CA-2; brand-approved POLISH-02 #10,
// adjusted by the brand: no capitals on the group titles; the toast region is "Avisos" and its dismiss "Dispensar aviso";
// the English is checked in the PR; the bell stays "Atividade", OXE-181). Written by the planner; the executor must not
// edit it.
// Today (main 4b7015c89) ActivityCenter.module.css .groupTitle is text-transform: uppercase with letter-spacing, and the
// toast region (src/ui/ToastStack.tsx, ui.toast.region / ui.toast.dismiss) says "Notificações" / "Dispensar
// notificação", a word the app's glossary does not use.
// Contract:
// - ToastStack's region is named t('ui.toast.region') and each toast's dismiss button t('ui.toast.dismiss'): in pt-BR
//   "Avisos" and "Dispensar aviso"; in English neither says "notification" (the PR proposes the words).
// - SOURCE-TEXT check (marked; jsdom applies no CSS module, the e2e spec pm-02-10 reads the tree in the app):
//   .groupTitle has no text-transform and no letter-spacing, and is font-size var(--fs-xs), font-weight
//   var(--weight-semibold), color var(--tx-secondary).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ToastStack from '../../../src/ui/ToastStack'
import { toast, useToasts } from '../../../src/ui/Toast'
import { changeLanguage, i18n } from '../../../src/i18n'

const css = readFileSync(join(process.cwd(), 'src/components/Activity/ActivityCenter.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const groupTitle = (): string => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].split(',').map(part => part.trim()).includes('.groupTitle')).map(match => match[2]).join(';')

beforeEach(() => { useToasts.setState({ items: [] } as never) })
afterEach(async () => { cleanup(); useToasts.setState({ items: [] } as never); await changeLanguage('en') })

describe('OXE-247 PM-02·10 Activity groups and the toast region', () => {
  it('in pt-BR the toast region is "Avisos" and its dismiss is "Dispensar aviso"', async () => {
    await changeLanguage('pt-BR')
    render(<ToastStack />)
    act(() => { toast({ title: 'Caminho copiado', intent: 'success' }) })
    const region = await waitFor(() => screen.getByRole('region', { name: 'Avisos' }))
    await waitFor(() => expect(within(region).getByRole('button', { name: 'Dispensar aviso' })).toBeInTheDocument())
  })

  it('in English the region and its dismiss do not say "notification"', async () => {
    await changeLanguage('en')
    expect(i18n.t('ui.toast.region')).not.toMatch(/notification/i)
    expect(i18n.t('ui.toast.dismiss')).not.toMatch(/notification/i)
  })

  it('the group titles have no capitals or tracking: --fs-xs, --weight-semibold, --tx-secondary (source text, marked)', () => {
    const body = groupTitle()
    expect(body.length, 'the .groupTitle rule').toBeGreaterThan(0)
    expect(body).not.toMatch(/text-transform/)
    expect(body).not.toMatch(/letter-spacing/)
    expect(body).toMatch(/font-size\s*:\s*var\(--fs-xs\)/)
    expect(body).toMatch(/font-weight\s*:\s*var\(--weight-semibold\)/)
    expect(body).toMatch(/(^|[;\s])color\s*:\s*var\(--tx-secondary\)/)
  })
})
