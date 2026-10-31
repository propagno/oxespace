import { useCallback, useEffect, useRef, useState } from 'react'
import { mainMessage } from '../../../../shared/messages'
import { applySideEvent, initialSideChat, SIDE_SEND_FAILED, withQuestion, type SideChatState } from './sideChatModel'

/**
 * One side chat for one conversation, for as long as the drawer is open: opens the copy, follows its events, sends
 * questions, and closes it (main deletes its session) when the drawer closes or the conversation changes.
 */
export function useSideChat(threadId: string): { state: SideChatState; send: (text: string) => Promise<void> } {
  const [state, setState] = useState<SideChatState>(initialSideChat)
  const sideId = useRef<string | null>(null)

  useEffect(() => {
    const api = window.oxe?.thread
    let live = true
    setState(initialSideChat())
    sideId.current = null
    const unsubscribe = api?.onSideEvent?.(({ sideId: from, event }) => {
      if (live && from === sideId.current) setState(current => applySideEvent(current, event))
    })
    if (!api?.sideOpen) {
      setState(current => ({ ...current, phase: 'refused', refusal: mainMessage('thread.side.unavailable', {}) }))
      return () => { live = false; unsubscribe?.() }
    }
    void api.sideOpen(threadId).then(result => {
      if (!live) {
        // Closed while it was opening: let main throw the copy away at once.
        if (result.ok) void api.sideClose?.(result.side.sideId).catch(() => undefined)
        return
      }
      if (!result.ok) { setState(current => ({ ...current, phase: 'refused', refusal: result.message })); return }
      sideId.current = result.side.sideId
      setState(current => ({ ...current, phase: 'open', sideId: result.side.sideId }))
    }, () => { if (live) setState(current => ({ ...current, phase: 'failed' })) })
    return () => {
      live = false
      unsubscribe?.()
      const open = sideId.current
      sideId.current = null
      if (open) void api.sideClose?.(open).catch(() => undefined)
    }
  }, [threadId])

  const send = useCallback(async (text: string) => {
    const open = sideId.current
    const question = text.trim()
    if (!open || !question) return
    setState(current => withQuestion(current, `local-${Date.now()}`, question))
    // Main's refusal is English for its log; the drawer says it in the interface's language.
    try {
      const api = window.oxe?.thread
      if (!api?.sideSend) throw new Error('No side chat in this build')
      await api.sideSend(open, question)
    } catch {
      setState(current => ({ ...current, busy: false, activity: null, error: SIDE_SEND_FAILED }))
    }
  }, [])

  return { state, send }
}
