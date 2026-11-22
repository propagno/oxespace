// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-270, PX-06·1, CA-3; A7). Written by the planner; the executor
// must not edit it. Glossary §7: the technical block of a failure is "Detalhes técnicos" / "Technical details", not
// "Diagnóstico do provedor" / "Provider diagnostic" (thread:failure.diagnostic, red on main f65fa5374). OxeChat F5
// (OXE-167) reshapes the failure card; both shapes name the detail block with thread:failure.diagnostic, so this file
// reads the accessible name of the block that holds the provider's detail.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { ThreadFailureCard } from '../../../src/components/Threads/ThreadFailureCard'
import { changeLanguage } from '../../../src/i18n'
import type { ThreadFailure } from '../../../shared/types/thread'

const failure: ThreadFailure = { id: 'failure-px06', occurredAt: 1790000000000, code: 'usage', message: 'Your session usage is exhausted.', detail: 'You have hit the session usage limit. Try again later.', providerCode: 'usageLimitExceeded' }

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('OXE-270 · PX-06·1 the failure card names its technical block', () => {
  test('ThreadFailureCard renders Detalhes técnicos in pt-BR and Technical details in en instead of Diagnóstico do provedor', async () => {
    await changeLanguage('pt-BR')
    render(<ThreadFailureCard event={{ type: 'completed', status: 'failed', failure }} latest />)
    expect(screen.getByLabelText('Detalhes técnicos')).toHaveTextContent(failure.detail!)
    expect(screen.queryByLabelText('Diagnóstico do provedor')).toBeNull()
    expect(document.body.textContent).not.toContain('Diagnóstico do provedor')
    cleanup()
    await changeLanguage('en')
    render(<ThreadFailureCard event={{ type: 'completed', status: 'failed', failure }} latest />)
    expect(screen.getByLabelText('Technical details')).toHaveTextContent(failure.detail!)
    expect(screen.queryByLabelText('Provider diagnostic')).toBeNull()
  })
})
