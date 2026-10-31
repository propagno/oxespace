import { lazy, Suspense, type ComponentProps, type ReactElement } from 'react'
import type { VoiceHud as Hud } from './VoiceHud'

const VoiceHud = lazy(() => import('./VoiceHud').then(module => ({ default: module.VoiceHud })))

/** The voice HUD, loaded the first time voice input has something to show, so panes do not carry it at boot. */
export function VoiceHudSlot(props: ComponentProps<typeof Hud>): ReactElement | null {
  const visible = Boolean(props.error || ['requesting', 'downloading', 'listening', 'transcribing'].includes(props.status))
  return visible ? <Suspense fallback={null}><VoiceHud {...props} /></Suspense> : null
}
