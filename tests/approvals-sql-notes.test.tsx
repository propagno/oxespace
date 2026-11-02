import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import en from '../shared/locales/en/main.json'
import ptBR from '../shared/locales/pt-BR/main.json'
import { mainMessage } from '../shared/messages'
import { changeLanguage } from '../src/i18n'
import { resetApprovalsApi } from '../src/components/Approvals/approvalsApi'
import { installApprovalsMock } from '../src/components/Approvals/approvalsMock'
import { resetApprovalsBoot } from '../src/components/Approvals/approvalsBoot'
import { useApprovalsStore } from '../src/components/Approvals/approvals.store'
import { ApprovalCenter } from '../src/components/Approvals/ApprovalCenter'
import type { ApprovalsMockHook } from '../src/components/Approvals/approvalsMock'

/**
 * OxeQuery's SQL risk reasons (SqlGuardVerdict.codes, #237) in the approval modal: the app's notes, worded by the
 * catalog in the person's language, never the guard's English string; an unknown code still shows, generically.
 */

const CODES = [
  mainMessage('oxequery.sql.copyProgram', {}),
  mainMessage('oxequery.sql.doBlock', {}),
  mainMessage('oxequery.sql.callProcedure', {}),
  mainMessage('oxequery.sql.destructiveInside', { statement: 'DO', keyword: 'DROP' }),
  mainMessage('oxequery.sql.rowLock', {})
]
const expected = (catalog: typeof en) => {
  const sql = catalog.messages.oxequery.sql
  return [sql.copyProgram, sql.doBlock, sql.callProcedure, sql.destructiveInside.replace('{{statement}}', 'DO').replace('{{keyword}}', 'DROP'), sql.rowLock]
}

let hook: ApprovalsMockHook
beforeEach(() => {
  resetApprovalsApi(); resetApprovalsBoot(); useApprovalsStore.getState().reset()
  hook = installApprovalsMock().hook
})
afterEach(cleanup)
afterAll(async () => { await changeLanguage('en') })

async function show(appNotes: unknown[]) {
  act(() => { hook.request({ kind: 'oxequery', appNotes: appNotes as never, title: mainMessage('approvals.title.oxequery', {}), summary: mainMessage('approvals.summary.oxequery.write', {}) }) })
  render(<ApprovalCenter armMs={0} />)
  await waitFor(() => expect(screen.getByTestId('approval-app-notes')).toBeInTheDocument())
  return within(screen.getByTestId('approval-app-notes')).getAllByRole('listitem').map(item => item.textContent)
}

describe('OxeQuery risk reasons in the approval modal', () => {
  it('shows each of the five SQL codes in English', async () => {
    await changeLanguage('en')
    expect(await show(CODES)).toEqual(expected(en))
  })

  it('shows each of the five SQL codes in Portuguese', async () => {
    await changeLanguage('pt-BR')
    const lines = await show(CODES)
    expect(lines).toEqual(expected(ptBR as unknown as typeof en))
    expect(lines).not.toEqual(expected(en))
  })

  it('an unknown code falls back to a generic "risky SQL" reason that names the code', async () => {
    await changeLanguage('en')
    expect(await show([{ code: 'oxequery.sql.futureThing', params: {} }])).toEqual(['Risky SQL: OXESpace flagged a risk in this statement that this version cannot describe (code oxequery.sql.futureThing).'])
    cleanup(); useApprovalsStore.getState().reset(); hook.reset()
    await changeLanguage('pt-BR')
    expect(await show([{ code: 'oxequery.sql.futureThing', params: {} }])).toEqual(['SQL arriscado: o OXESpace apontou um risco neste comando que esta versão não consegue descrever (código oxequery.sql.futureThing).'])
  })
})
