import { create } from 'zustand'
import type { AgentHookStatusEvent } from '../../shared/types/agent-hooks'

export const TOOL_OUTPUT_CUT_BYTES = 32 * 1024

export interface ToolOutputCutInfo {
  truncated: boolean
  keptBytes: number
  totalBytes?: number
}

export function resolveToolOutputCut(
  cut: ToolOutputCutInfo | undefined,
  rawOutput: string | undefined,
  outputTruncated?: boolean
): ToolOutputCutInfo | undefined {
  if (cut?.truncated) return cut
  if (rawOutput && rawOutput.length > TOOL_OUTPUT_CUT_BYTES) {
    return { truncated: true, keptBytes: TOOL_OUTPUT_CUT_BYTES, totalBytes: rawOutput.length }
  }
  if (outputTruncated && rawOutput) {
    return { truncated: true, keptBytes: Math.min(rawOutput.length, TOOL_OUTPUT_CUT_BYTES) }
  }
  return undefined
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
