import { useState, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { OxeQueryConnection } from '../../../shared/types/oxequery'
import { ErrorState } from '../../ui/Display'
import { errorMessage, oq } from './client'
import { useOxeQueryStore } from './oxequery.store'

/** Shown under an error that looks like a dropped connection: dial again now, or close its tab. */
export function ReconnectBar({ connection, onReconnected }: { connection: OxeQueryConnection; onReconnected?: () => void }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'fail'; message: string }>({ kind: 'idle', message: '' })
  const reconnect = async (): Promise<void> => {
    setState({ kind: 'busy', message: '' })
    try {
      const result = await oq('connections.reconnect', { id: connection.id })
      setState(result.ok ? { kind: 'ok', message: result.serverVersion ? t('reconnect.connectedTo', { version: result.serverVersion }) : t('reconnect.connected') } : { kind: 'fail', message: result.message })
      if (result.ok) onReconnected?.()
    } catch (cause) { setState({ kind: 'fail', message: errorMessage(cause) }) }
  }
  return <div className="oq-reconnect" role="group" aria-label={t('reconnect.label')}>
    <span><Trans t={t} i18nKey="reconnect.text" values={{ name: connection.name }} components={{ strong: <strong /> }} /></span>
    <button type="button" disabled={state.kind === 'busy'} onClick={() => void reconnect()}>{state.kind === 'busy' ? t('reconnect.busy') : t('reconnect.reconnect')}</button>
    <button type="button" onClick={() => useOxeQueryStore.getState().closeTab(`connection:${connection.id}`)}>{t('reconnect.closeTab')}</button>
    {state.kind === 'ok' && <em role="status">{state.message}</em>}
    {state.kind === 'fail' && <ErrorState compact title={t('reconnect.failed')} message={state.message} />}
  </div>
}
