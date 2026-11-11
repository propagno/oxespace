import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../ui'
import { useThreadStore } from '../../store/thread.store'

/** A file this conversation edits that another conversation also edits (BACKEND #704 §A54). */
export interface ThreadCollision {
  file: string
  checkoutId: string
  others: Array<{ conversationId: string; title: string }>
}

interface CollisionBridge {
  collisions?: (threadId: string) => Promise<ThreadCollision[] | null | undefined>
  onPlacesChanged?: (listener: (event: { threadId?: string } | undefined) => void) => () => void
}

function bridge(): CollisionBridge | undefined {
  return (window as unknown as { oxe?: { thread?: CollisionBridge } }).oxe?.thread
}

/** Titles longer than this are cut so a chip stays one line. */
export const COLLISION_TITLE_MAX = 40
/** At most this many conversations get a chip; the rest read "+N". */
export const COLLISION_CHIPS_MAX = 2

interface ConversationFiles {
  conversationId: string
  title: string
  files: string[]
}

/** Groups the collisions by the other conversation, keeping the order main reported them in. */
export function groupCollisions(collisions: readonly ThreadCollision[]): ConversationFiles[] {
  const byConversation = new Map<string, ConversationFiles>()
  for (const collision of collisions) {
    for (const other of collision.others) {
      const entry = byConversation.get(other.conversationId) ?? { conversationId: other.conversationId, title: other.title, files: [] }
      if (!entry.files.includes(collision.file)) entry.files.push(collision.file)
      byConversation.set(other.conversationId, entry)
    }
  }
  return [...byConversation.values()]
}

function shortTitle(title: string): string {
  return title.length > COLLISION_TITLE_MAX ? `${title.slice(0, COLLISION_TITLE_MAX)}…` : title
}

/** The collision warning (DESIGN U4.5): one chip per other conversation that edits the same files; a chip opens it. */
export function CollisionChips(props: { threadId: string }): ReactElement | null {
  const { threadId } = props
  const { t } = useTranslation('thread')
  const [collisions, setCollisions] = useState<ThreadCollision[]>([])

  useEffect(() => {
    const api = bridge()
    let alive = true
    const read = (): void => {
      void api?.collisions?.(threadId).then(value => { if (alive) setCollisions(Array.isArray(value) ? value : []) }, () => undefined)
    }
    setCollisions([])
    read()
    const off = api?.onPlacesChanged?.(event => {
      if (event?.threadId && event.threadId !== threadId) return
      read()
    })
    return () => { alive = false; off?.() }
  }, [threadId])

  const groups = groupCollisions(collisions)
  if (groups.length === 0) return null
  const shown = groups.slice(0, COLLISION_CHIPS_MAX)
  const hidden = groups.length - shown.length
  return (
    <div className="collision-chips" data-tone="warning">
      {shown.map(group => {
        const [first, ...rest] = group.files
        return (
          <Button key={group.conversationId} size="sm" variant="ghost" title={first}
            onClick={() => { void useThreadStore.getState().select(group.conversationId) }}>
            {t('collision.alsoEditedBy', { title: shortTitle(group.title), interpolation: { escapeValue: false } })}
            {': '}
            <code className="collision-chip-file">{first}</code>
            {rest.length > 0 ? ` ${t('collision.more', { count: rest.length })}` : ''}
          </Button>
        )
      })}
      {hidden > 0 && <span className="collision-chips-more">{`+${hidden}`}</span>}
    </div>
  )
}
