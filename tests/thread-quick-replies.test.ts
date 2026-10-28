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
  it('does not turn quoted text into answers when nothing asks for them', () => {
    // The message that showed status texts as replies: a quote near the word "reply" is not a request to reply with it.
    expect(threadQuickReplies('That text should only last until the main process replies. After that it switches to "Indexing… N files so far" or "N files indexed". For it to stay stuck, the call would have to never reply.')).toEqual([])
    expect(threadQuickReplies('Reply when you can. The status says "Starting the index…" for a moment.')).toEqual([])
    expect(threadQuickReplies("I don't think 'Load more' needs a reply.")).toEqual([])
  })
  it('offers each answer an explicit request names, in English and in Portuguese', () => {
    expect(threadQuickReplies('Reply "yes", "no" or "later".').map(reply => reply.value)).toEqual(['yes', 'no', 'later'])
    expect(threadQuickReplies('Responda com "seguir" ou "parar".').map(reply => reply.value)).toEqual(['seguir', 'parar'])
    expect(threadQuickReplies("Type 'merge' to continue.").map(reply => reply.value)).toEqual(['merge'])
  })
})
