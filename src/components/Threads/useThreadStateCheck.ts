import { useEffect, useRef, useState } from 'react'
import type { ThreadProviderObservation, ThreadSnapshot } from '../../../shared/types/thread'

/** Only observes a visible, silent, acknowledged turn. Never retries its input. */
export function useThreadStateCheck(snapshot: ThreadSnapshot, awaitingInput: boolean) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ key: string; value: ThreadProviderObservation }>()
  const turn = snapshot.turns?.at(-1)
  const key = `${snapshot.thread.id}:${snapshot.thread.generation}:${turn?.id}:${turn?.nativeId}`
  const signal = snapshot.thread.connection?.lastNativeSignalAt ?? turn?.startedAt ?? snapshot.thread.updatedAt
  const budget = useRef({ key: '', signal: 0, attempts: 0 })
  const eligible = snapshot.thread.provider === 'codex' && snapshot.thread.status === 'running' && Boolean(turn?.nativeId) && !awaitingInput
  useEffect(() => {
    const observe = window.oxe.thread?.observe
    if (!eligible || !observe) { setChecking(false); return }
    if (budget.current.key !== key || budget.current.signal !== signal) budget.current = { key, signal, attempts: 0 }
    let cancelled = false, timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      if (cancelled || budget.current.attempts >= 3) return
      const delay = budget.current.attempts === 0 ? Math.max(0, signal + 60000 - Date.now()) : 60000 * 2 ** budget.current.attempts
      timer = setTimeout(async () => {
        budget.current.attempts++
        setChecking(true)
        let terminal = false
        try {
          const value = await observe(snapshot.thread.id)
          if (cancelled) return
          setResult({ key, value })
          terminal = ['completed', 'failed', 'interrupted'].includes(value.state)
        } catch { /* Diagnostics provides an explicit retry; no input is resent. */ }
        finally {
          if (!cancelled) { setChecking(false); if (!terminal) schedule() }
        }
      }, delay)
    }
    schedule()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [eligible, key, signal, snapshot.thread.id])
  return { checking, observation: result?.key === key ? result.value : undefined }
}
