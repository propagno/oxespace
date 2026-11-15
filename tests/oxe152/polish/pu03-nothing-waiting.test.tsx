// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-212, PU-03·10, as narrowed by the coordination on 15/11:
// ONLY the empty wording of the activity center and of the shortcut, no pill; glossary §5 "one state, one verb").
// Written by the planner; the executor must not edit it.
// Today (main 4b7015c89) Ctrl+Shift+U with nothing waiting says activityCenter.nothingWaiting ("Nada esperando por
// você"), but the activity center (the bell's ActivityPanel) with nothing in it says activity.empty ("Nada ainda").
// Contract:
// - ActivityPanel with no item shows its EmptyState titled t('activityCenter.nothingWaiting'): "Nada esperando por você"
//   in pt-BR, "Nothing waiting for you" in English; the catalog key is the shortcut's, so the two never drift apart.
// - The shortcut's toast (NextAttentionHost, attention.next, NEXT_ATTENTION_EVENT) still says the same words.
// - No pill: BRD-09 (OXE-72 CA-2, frozen in brd09-titlebar) keeps the needs-you pill absent at zero; this card adds no
//   pill and no "Nada esperando" short form.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityPanel } from '../../../src/components/Activity/ActivityPanel'
import { NextAttentionHost } from '../../../src/components/Attention/NextAttentionHost'
import { NEXT_ATTENTION_EVENT } from '../../../src/app/nextAttention'
import { useActivityStore } from '../../../src/store/activity.store'
import { useToasts } from '../../../src/ui/Toast'
import { changeLanguage, i18n } from '../../../src/i18n'

beforeEach(() => {
  useActivityStore.setState({ items: [], live: { code: {}, thread: {} } } as never)
  useToasts.setState({ items: [] } as never)
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-212 PU-03·10 one wording for "nothing waiting"', () => {
  it.each([['pt-BR', 'Nada esperando por você'], ['en', 'Nothing waiting for you']])('the empty activity center (%s) says "%s"', async (locale, words) => {
    await changeLanguage(locale)
    expect(i18n.t('activityCenter.nothingWaiting')).toBe(words)
    render(<ActivityPanel onClose={() => {}} onSelectView={() => {}} />)
    expect(screen.getByText(words)).toBeInTheDocument()
    expect(document.body.textContent ?? '').not.toContain(i18n.t('activity.empty'))
  })

  it('the shortcut with nothing waiting says the same words', async () => {
    await changeLanguage('pt-BR')
    render(<NextAttentionHost selectView={() => {}} />)
    window.dispatchEvent(new Event(NEXT_ATTENTION_EVENT))
    await waitFor(() => expect(useToasts.getState().items.map(item => item.title)).toContain('Nada esperando por você'))
  })
})
