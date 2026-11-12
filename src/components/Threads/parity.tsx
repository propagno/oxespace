import { useId, type ReactElement, type ReactNode } from 'react'
import { threadProductName } from '../../../shared/threadProviders'
import { useTranslation } from 'react-i18next'
import { parityFor, type ParityFeature } from '../../../shared/provider-parity'
import type { ThreadCapabilityManifest, ThreadProvider as ParityProvider } from '../../../shared/types/thread'

export type { ParityProvider }
import { formatMainMessage } from '../../i18n/mainMessage'
import { Button } from '../../ui'

export interface ParitySource {
  manifest?: Pick<ThreadCapabilityManifest, 'features'>
  provider: ParityProvider
}

export function parityState(source: ParitySource, feature: ParityFeature): { enabled: boolean; reason: string | null } {
  const fromManifest = source.manifest?.features?.[feature]
  if (fromManifest) {
    if (fromManifest.enabled) return { enabled: true, reason: null }
    const reason = fromManifest.messageCode
      ? formatMainMessage(fromManifest.messageCode)
      : (fromManifest.reason ?? formatMainMessage({
          code: 'parity.notAvailable',
          params: { provider: threadProductName(source.provider) }
        }))
    return { enabled: false, reason }
  }
  const fallback = parityFor(source.provider, feature)
  if (fallback.available) return { enabled: true, reason: null }
  return { enabled: false, reason: formatMainMessage(fallback.refusal) }
}

export interface ParityButtonProps {
  manifest?: Pick<ThreadCapabilityManifest, 'features'>
  provider: ParityProvider
  feature: ParityFeature
  onClick: () => void
  children: ReactNode
}

export function ParityButton({ manifest, provider, feature, onClick, children }: ParityButtonProps): ReactElement {
  useTranslation('main')
  const descId = useId()
  const { enabled, reason } = parityState({ manifest, provider }, feature)
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={!enabled}
        title={reason ?? undefined}
        aria-describedby={reason ? descId : undefined}
        onClick={enabled ? onClick : undefined}
      >
        {children}
      </Button>
      {reason ? <span id={descId} className="sr-only">{reason}</span> : null}
    </>
  )
}
