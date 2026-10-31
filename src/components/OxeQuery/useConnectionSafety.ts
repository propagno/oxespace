import { useEffect, useState } from 'react'
import type { ConnectionSafety, OxeQueryConnection } from '../../../shared/types/oxequery'
import { effectiveSafety, DEFAULT_ENVIRONMENT_LIMITS } from '../../../shared/oxequerySafety'
import { oq } from './client'
import { useOxeQueryStore } from './oxequery.store'

/** What the connection's own settings say until the main process answers; it is the answer when nothing lowers them. */
export function ownSafety(connection: OxeQueryConnection): ConnectionSafety {
  return effectiveSafety(connection, DEFAULT_ENVIRONMENT_LIMITS, false)
}

/**
 * What the connection allows right now: its own settings lowered by the environment's limits and by organization
 * policy. The main process decides (and enforces) this; the toolbar only shows it. It is read again when the
 * connection or the settings change, and when the window comes back, since a policy file can change meanwhile.
 */
export function useConnectionSafety(connection: OxeQueryConnection): ConnectionSafety {
  const settingsOpen = useOxeQueryStore(state => state.preferencesOpen)
  const [safety, setSafety] = useState<ConnectionSafety>(() => ownSafety(connection))
  useEffect(() => {
    let alive = true
    const read = (): void => { oq('safety.get', { connectionId: connection.id }).then(value => { if (alive) setSafety(value) }, () => undefined) }
    read()
    window.addEventListener('focus', read)
    return () => { alive = false; window.removeEventListener('focus', read) }
    // The rest of the connection is listed so an edit of its limits or name is read again.
  }, [connection.id, connection.environment, connection.readOnly, connection.maxRows, connection.statementTimeoutMs, connection.name, settingsOpen])
  return safety
}
