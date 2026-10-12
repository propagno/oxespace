import { describe, expect, it } from 'vitest'
import { threadQuickReplies } from '../src/components/Threads/threadQuickReplies'

describe('explicit replies in agent prose', () => {
  it('offers only literal lettered options with an option heading', () => {
    expect(threadQuickReplies('As opções:\n- **A (Recomendado):** Use the safe rollout.\n- **B:** Delay the rollout.')).toEqual([
      { label: 'A (Recomendado)', value: 'A' }, { label: 'B', value: 'B' }
    ])
  })
  it('offers quoted answers when the agent explicitly asks for them', () => {
    expect(threadQuickReplies('Responda "grilling" ou responda às perguntas, por exemplo "ok para todas".')).toEqual([
      { label: 'grilling', value: 'grilling' }, { label: 'ok para todas', value: 'ok para todas' }
    ])
  })
  it('does not invent choices from an ordinary message', () => {
    expect(threadQuickReplies('I analyzed options A and B. What should we do?')).toEqual([])
  })
})
