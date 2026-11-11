import { create } from 'zustand'
import type { AgentHookStatusEvent } from '../../shared/types/agent-hooks'

export interface ToolOutputCutInfo {
  truncated: boolean
  keptBytes: number
  totalBytes?: number
}

interface ToolOutputCutState {
  cuts: Record<string, ToolOutputCutInfo>
  recordCut: (toolUseId: string, output: ToolOutputCutInfo) => void
}

export const useToolOutputCuts = create<ToolOutputCutState>((set) => ({
  cuts: {},
  recordCut: (toolUseId, output) =>
    set((state) => ({ cuts: { ...state.cuts, [toolUseId]: output } }))
}))

let unsubscribe: (() => void) | null = null

export function startToolOutputCuts(): () => void {
  if (unsubscribe) return unsubscribe
  const unsub = window.oxe?.agentHooks?.onStatus?.((event: AgentHookStatusEvent) => {
    if (event.toolUseId && event.output?.truncated) {
      useToolOutputCuts.getState().recordCut(event.toolUseId, event.output)
    }
  })
  unsubscribe = () => {
    unsub?.()
    unsubscribe = null
    useToolOutputCuts.setState({ cuts: {} })
  }
  return unsubscribe
}
