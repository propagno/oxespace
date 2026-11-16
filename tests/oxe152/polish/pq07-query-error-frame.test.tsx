// Frozen acceptance test for 1.5.2 Polimento · OxeQuery (Jira OXE-224, PQ-07·11), coordination 15/11 with MARCA's
// structure. Written by the planner; the executor must not edit it.
// Contract: a failed statement renders ONE frame, data-ui="query-error", that holds two siblings: the role="alert"
// element (the title, the plain headline with its recovery, the Copy action) and the <details> "Technical details"
// with the engine's raw message. The alert is a live region, so the raw message is never inside it: the details are
// closed by default, and opening them changes nothing inside [role=alert]. The error appearing never moves the focus.
// Red today: QueryError's wrapper has no data-ui="query-error" (the frame is the ErrorState's own box).
import { act, cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { QueryError } from '../../../src/components/OxeQuery/QueryError'

const failure = { message: 'relation "tabela_que_nao_existe" does not exist', sqlState: '42P01', position: 15 }

afterEach(cleanup)

describe('PQ-07·11 the query error frame (OXE-224, A6)', () => {
  test('PQ-07·11 one frame holds the alert and the technical details as siblings', () => {
    const { container } = render(<QueryError error={failure} />)
    const frame = container.querySelector('[data-ui="query-error"]')
    expect(frame, 'the error frame, data-ui="query-error"').not.toBeNull()
    const alert = frame!.querySelector('[role="alert"]')
    const details = frame!.querySelector('details')
    expect(alert, 'the alert inside the frame').not.toBeNull()
    expect(details, 'the technical details inside the frame').not.toBeNull()
    expect(alert!.contains(details!), 'the details are not inside the live region').toBe(false)
    expect(details!.contains(alert!), 'the alert is not inside the details').toBe(false)
  })

  test('PQ-07·11 the details are closed by default and the alert never holds the raw message', () => {
    const { container } = render(<QueryError error={failure} />)
    const alert = container.querySelector('[role="alert"]')!
    const details = container.querySelector('details')!
    expect(details.open, 'closed by default').toBe(false)
    expect(alert.textContent ?? '', 'the alert says what went wrong').not.toBe('')
    expect(alert.textContent, 'the engine’s raw message is never in the live region').not.toContain('tabela_que_nao_existe')
    expect(details.textContent, 'the raw message is in the details').toContain('tabela_que_nao_existe')
  })

  test('PQ-07·11 opening Technical details changes nothing inside the alert', () => {
    const { container } = render(<QueryError error={failure} />)
    const alert = container.querySelector('[role="alert"]')!
    const details = container.querySelector('details')!
    const before = alert.innerHTML
    act(() => { details.open = true; details.dispatchEvent(new Event('toggle')) })
    expect(details.open).toBe(true)
    expect(alert.innerHTML, 'nothing new is announced when the details open').toBe(before)
  })

  test('PQ-07·11 the error appearing does not move the focus', () => {
    function Host({ show }: { show: boolean }): ReactElement {
      return <div><input aria-label="editor" />{show ? <QueryError error={failure} /> : null}</div>
    }
    const { rerender, getByLabelText } = render(<Host show={false} />)
    const editor = getByLabelText('editor')
    editor.focus()
    rerender(<Host show />)
    expect(document.activeElement, 'the focus stays where the person was').toBe(editor)
  })
})
