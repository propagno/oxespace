import { lazy, Suspense, useEffect, type ReactElement } from 'react'
import { followRemoteGateway, remoteApi, useRemoteStore } from '../../store/remote.store'
import { scheduleIdle } from '../../lib/preloadSchedule'

const PairingPromptDialog = lazy(() => import('./PairingPromptDialog'))

/**
 * T86: a phone asking to pair reaches the person wherever they are. Mounted once at the app's root, it follows the
 * gateway from the start (at idle, after the first paint) and shows "Pair <phone>?" over whatever is on screen; the
 * dialog itself loads only when a phone asks.
 */
export function RemotePairingHost(): ReactElement | null {
  const prompt = useRemoteStore(state => state.pairing)
  useEffect(() => remoteApi() ? scheduleIdle(followRemoteGateway) : undefined, [])
  return prompt ? <Suspense fallback={null}><PairingPromptDialog key={prompt.promptId} prompt={prompt} /></Suspense> : null
}
