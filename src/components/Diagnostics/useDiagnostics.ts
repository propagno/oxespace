import { useCallback, useEffect, useState } from 'react'
import { CPU_SAMPLES, sumCpu } from './diagnosticsHealth'
import { DIAGNOSTICS_LIMITS, type DiagnosticsIncident, type DiagnosticsMetrics } from '../../../shared/types/diagnostics'

export type LiveStatus = 'loading' | 'live' | 'unavailable' | 'failed'

const canWatch = (): boolean => { const api = window.oxe?.diagnostics; return Boolean(api?.watch && api.unwatch && api.onMetrics) }

/**
 * Live measurements while the calling component is mounted, and never otherwise: it subscribes on mount and
 * unsubscribes on unmount. A subscription that answers after the component left is ended at once.
 */
export function useDiagnosticsMetrics(): { metrics: DiagnosticsMetrics | null; cpuSamples: number[]; status: LiveStatus } {
  const [metrics, setMetrics] = useState<DiagnosticsMetrics | null>(null)
  const [cpuSamples, setCpuSamples] = useState<number[]>([])
  const [status, setStatus] = useState<LiveStatus>(() => canWatch() ? 'loading' : 'unavailable')

  useEffect(() => {
    const api = window.oxe?.diagnostics
    if (!api?.watch || !api.unwatch || !api.onMetrics) return
    const unwatch = api.unwatch.bind(api)
    let alive = true
    let subscriptionId: string | null = null
    const stopListening = api.onMetrics(next => {
      if (!alive) return
      setMetrics(next)
      setCpuSamples(samples => [...samples, sumCpu(next)].slice(-CPU_SAMPLES))
      setStatus('live')
    })
    api.watch({ intervalMs: DIAGNOSTICS_LIMITS.defaultIntervalMs }).then(
      ({ subscriptionId: id }) => {
        if (alive) subscriptionId = id
        else void unwatch({ subscriptionId: id }).catch(() => undefined)
      },
      () => { if (alive) setStatus('failed') }
    )
    return () => {
      alive = false
      stopListening()
      if (subscriptionId) void unwatch({ subscriptionId }).catch(() => undefined)
    }
  }, [])

  return { metrics, cpuSamples, status }
}

export type JournalStatus = 'loading' | 'ready' | 'unavailable' | 'failed'

/** The problem journal, read on mount and again whenever the main process says it changed. */
export function useIncidents(): { incidents: DiagnosticsIncident[]; status: JournalStatus; reload: () => void } {
  const [incidents, setIncidents] = useState<DiagnosticsIncident[]>([])
  const [status, setStatus] = useState<JournalStatus>(() => window.oxe?.diagnostics?.incidents ? 'loading' : 'unavailable')
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion(value => value + 1), [])

  useEffect(() => {
    const api = window.oxe?.diagnostics
    if (!api?.onIncidentsChanged) return
    return api.onIncidentsChanged(() => reload())
  }, [reload])

  useEffect(() => {
    const api = window.oxe?.diagnostics
    if (!api?.incidents) return
    let alive = true
    api.incidents({ limit: DIAGNOSTICS_LIMITS.maxIncidentsPage }).then(
      list => { if (alive) { setIncidents([...list].sort((a, b) => b.lastAt - a.lastAt)); setStatus('ready') } },
      () => { if (alive) setStatus('failed') }
    )
    return () => { alive = false }
  }, [version])

  return { incidents, status, reload }
}
