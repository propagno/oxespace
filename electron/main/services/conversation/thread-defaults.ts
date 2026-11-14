import type { AppDatabase } from '../../db'
import { isThreadAccess, NEW_CONVERSATION_ACCESS_DEFAULT, type ThreadAccess } from '../../../../shared/threadAccess'

const KEY = 'new_conversation_access'

/** The access a conversation created by the person starts with (Settings > Agents). */
export function newConversationAccess(db: AppDatabase): ThreadAccess {
  try {
    const row = db.prepare('SELECT value FROM thread_settings WHERE key = ?').get(KEY) as { value: string } | undefined
    return isThreadAccess(row?.value) ? row.value : NEW_CONVERSATION_ACCESS_DEFAULT
  } catch { return NEW_CONVERSATION_ACCESS_DEFAULT }
}

export function setNewConversationAccess(db: AppDatabase, access: unknown): ThreadAccess {
  if (!isThreadAccess(access)) throw Error('Choose Read only, Can edit or Full access')
  db.prepare('INSERT INTO thread_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').run(KEY, access, Date.now())
  return access
}
