import { useEffect, useState } from 'react'

/**
 * Whether this build offers Shared Project Memory. `null` while unknown (render nothing),
 * `false` when the main process reports the feature off. Without a preload API (tests,
 * previews) the interface keeps its normal behaviour.
 */
export function useSharedProjectMemory(workspaceId: string | undefined): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    let alive = true
    if (!workspaceId || typeof window.oxe?.memory?.status !== 'function') { setEnabled(!workspaceId ? false : true); return }
    void window.oxe.memory.status(workspaceId).then(status => { if (alive) setEnabled(status.featureEnabled !== false) }).catch(() => { if (alive) setEnabled(false) })
    return () => { alive = false }
  }, [workspaceId])
  return enabled
}
