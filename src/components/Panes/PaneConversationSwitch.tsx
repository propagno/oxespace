import { MessageSquare, SquareTerminal } from 'lucide-react'
import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { usePaneConversationView } from '../../store/pane-conversation-view.store'
import { Button } from '../../ui'

export function PaneConversationSwitch(props: { paneId: string }): ReactElement | null {
  const { paneId } = props
  const { t: tc } = useTranslation('code')
  const { t: tm } = useTranslation('mobile')
  const mode = usePaneConversationView((state) => state.views[paneId] ?? 'terminal')
  const setMode = usePaneConversationView((state) => state.setMode)
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let active = true
    const api = window.oxe?.paneConversation

    const check = (): void => {
      if (!api?.has) {
        if (active) setAvailable(false)
        return
      }
      void api.has(paneId).then(
        (result) => {
          if (active) setAvailable(Boolean(result))
        },
        () => {
          if (active) setAvailable(false)
        }
      )
    }

    check()
    const unsubscribe = api?.onChanged?.((event) => {
      if (event?.paneId === paneId) check()
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [paneId])

  if (!available) return null

  return (
    <div className="pane-conversation-switch" role="group" aria-label={tc('pane.conversation.switchLabel')}>
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={mode === 'terminal'}
        onClick={(event) => {
          event.stopPropagation()
          setMode(paneId, 'terminal')
        }}
      >
        <SquareTerminal size={12} aria-hidden="true" />
        {tc('pane.conversation.terminal')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={mode === 'conversation'}
        onClick={(event) => {
          event.stopPropagation()
          setMode(paneId, 'conversation')
        }}
      >
        <MessageSquare size={12} aria-hidden="true" />
        {tm('terminal.conversation.conversation')}
      </Button>
    </div>
  )
}
