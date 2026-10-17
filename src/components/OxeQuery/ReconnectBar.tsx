import { useState, type ReactElement } from 'react'
import type { OxeQueryConnection } from '../../../shared/types/oxequery'
import { errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'

/** Shown under an error that looks like a dropped connection: dial again now, or let go of it. */
export function ReconnectBar({ connection, onReconnected }: { connection: OxeQueryConnection; onReconnected?: () => void }): ReactElement {
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'fail'; message: string }>({ kind: 'idle', message: '' })
  const reconnect = async (): Promise<void> => {
    setState({ kind: 'busy', message: '' })
    try {
      const result = await oq('connections.reconnect', { id: connection.id })
      setState(result.ok ? { kind: 'ok', message: `Connected${result.serverVersion ? ` to ${result.serverVersion}` : ''}.` } : { kind: 'fail', message: result.message })
      if (result.ok) onReconnected?.()
    } catch (cause) { setState({ kind: 'fail', message: errorMessage(cause) }) }
  }
  return <div className="oq-reconnect" role="group" aria-label="Connection lost">
    <span>The connection to <strong>{connection.name}</strong> was lost. The next statement dials again by itself; you can also do it now or close this connection.</span>
    <button type="button" disabled={state.kind === 'busy'} onClick={() => void reconnect()}>{state.kind === 'busy' ? 'Reconnecting…' : 'Reconnect'}</button>
    <button type="button" onClick={() => useOxeQueryStore.getState().closeTab(`connection:${connection.id}`)}>Disconnect</button>
    {state.kind === 'ok' && <em role="status">{state.message}</em>}
    {state.kind === 'fail' && <em role="alert">{state.message}</em>}
  </div>
}
