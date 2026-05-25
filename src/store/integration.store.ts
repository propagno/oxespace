import { create } from 'zustand'
import type {
  AddIntegrationMemberInput,
  CreateIntegrationGroupInput,
  CreateIntegrationHandoffInput,
  IntegrationContextResult,
  IntegrationGroup,
  IntegrationHandoff,
  UpdateIntegrationGroupInput,
  UpdateIntegrationHandoffInput,
  UpdateIntegrationMemberInput
} from '../../shared/types/integration'

interface IntegrationState {
  groups: IntegrationGroup[]
  handoffs: Record<string, IntegrationHandoff[]>
  activeGroupId: string | null
  activeMemberId: string | null
  isLoading: boolean
  error: string | null
  load: (workspaceId?: string | null) => Promise<void>
  setActiveGroup: (groupId: string | null) => void
  setActiveMember: (memberId: string | null) => void
  createGroup: (input: CreateIntegrationGroupInput) => Promise<IntegrationGroup>
  deleteGroup: (groupId: string) => Promise<void>
  addMember: (input: AddIntegrationMemberInput) => Promise<IntegrationGroup>
  updateMember: (input: UpdateIntegrationMemberInput) => Promise<IntegrationGroup>
  removeMember: (memberId: string) => Promise<IntegrationGroup>
  loadHandoffs: (groupId: string) => Promise<void>
  createHandoff: (input: CreateIntegrationHandoffInput) => Promise<IntegrationHandoff>
  updateHandoff: (input: UpdateIntegrationHandoffInput) => Promise<IntegrationHandoff>
  updateGroup: (input: UpdateIntegrationGroupInput) => Promise<IntegrationGroup>
  attachLatestSession: (input: { groupId: string; memberId: string; workspaceId: string; rootPath: string; provider: import('../../shared/types/agent').AgentProvider }) => Promise<void>
  buildContext: (groupId: string, currentMemberId?: string | null) => Promise<IntegrationContextResult>
  clearError: () => void
}

export const useIntegrationStore = create<IntegrationState>((set, get) => ({
  groups: [],
  handoffs: {},
  activeGroupId: null,
  activeMemberId: null,
  isLoading: false,
  error: null,

  load: async (workspaceId) => {
    set({ isLoading: true, error: null })
    try {
      const groups = await window.oxe.integration.listGroups({ workspaceId: workspaceId ?? null })
      set((state) => ({
        groups,
        activeGroupId: state.activeGroupId && groups.some((g) => g.id === state.activeGroupId)
          ? state.activeGroupId
          : groups[0]?.id ?? null,
        activeMemberId: resolveMemberSelection(groups, state.activeGroupId, state.activeMemberId),
        isLoading: false
      }))
    } catch (error) {
      set({ error: toMessage(error), isLoading: false })
    }
  },

  setActiveGroup: (groupId) => set((state) => ({
    activeGroupId: groupId,
    activeMemberId: groupId
      ? state.groups.find((group) => group.id === groupId)?.members[0]?.id ?? null
      : null
  })),
  setActiveMember: (memberId) => set({ activeMemberId: memberId }),

  createGroup: async (input) => {
    const group = await window.oxe.integration.createGroup(input)
    set((state) => ({ groups: [group, ...state.groups], activeGroupId: group.id, activeMemberId: group.members[0]?.id ?? null, error: null }))
    return group
  },

  deleteGroup: async (groupId) => {
    await window.oxe.integration.deleteGroup(groupId)
    set((state) => {
      const groups = state.groups.filter((group) => group.id !== groupId)
      const removedActiveGroup = state.activeGroupId === groupId
      const activeGroupId = removedActiveGroup ? groups[0]?.id ?? null : state.activeGroupId
      return {
        groups,
        handoffs: Object.fromEntries(Object.entries(state.handoffs).filter(([id]) => id !== groupId)),
        activeGroupId,
        activeMemberId: removedActiveGroup && activeGroupId
          ? groups.find((group) => group.id === activeGroupId)?.members[0]?.id ?? null
          : removedActiveGroup
            ? null
            : state.activeMemberId,
        error: null
      }
    })
  },

  addMember: async (input) => replaceGroup(await window.oxe.integration.addMember(input), set),
  updateMember: async (input) => replaceGroup(await window.oxe.integration.updateMember(input), set),
  removeMember: async (memberId) => replaceGroup(await window.oxe.integration.removeMember(memberId), set),

  loadHandoffs: async (groupId) => {
    try {
      const list = await window.oxe.integration.listHandoffs(groupId)
      set((state) => ({ handoffs: { ...state.handoffs, [groupId]: list }, error: null }))
    } catch (error) {
      set({ error: toMessage(error) })
    }
  },

  createHandoff: async (input) => {
    const handoff = await window.oxe.integration.createHandoff(input)
    const list = [handoff, ...(get().handoffs[input.groupId] ?? [])]
    set((state) => ({ handoffs: { ...state.handoffs, [input.groupId]: list }, error: null }))
    return handoff
  },

  updateHandoff: async (input) => {
    const updated = await window.oxe.integration.updateHandoff(input)
    // The IPC returns the freshly-saved row but doesn't tell us which group
    // it belongs to — we already know it from the existing cache, so we
    // patch the right list in place. Falling back to a full re-list would
    // also work but is more expensive when only one row changed.
    set((state) => {
      const nextHandoffs: Record<string, IntegrationHandoff[]> = {}
      for (const [groupId, list] of Object.entries(state.handoffs)) {
        nextHandoffs[groupId] = list.map((h) => h.id === updated.id ? updated : h)
      }
      return { handoffs: nextHandoffs, error: null }
    })
    return updated
  },

  updateGroup: async (input) => {
    const group = await window.oxe.integration.updateGroup(input)
    set((state) => ({
      groups: state.groups.map((g) => g.id === group.id ? group : g),
      error: null
    }))
    return group
  },

  attachLatestSession: async (input) => {
    const sessions = await window.oxe.session.list({ workspaceId: input.workspaceId, workspaceRootPath: input.rootPath, provider: input.provider })
    const latest = [...sessions].sort((a, b) => b.lastUpdatedMs - a.lastUpdatedMs)[0]
    if (!latest) throw new Error(`No ${input.provider} session found for this member.`)
    await window.oxe.integration.attachSession({
      groupId: input.groupId,
      memberId: input.memberId,
      workspaceId: input.workspaceId,
      rootPath: input.rootPath,
      provider: input.provider,
      sessionId: latest.sessionId,
      label: latest.firstMessagePreview ?? latest.modelId ?? null
    })
    await get().load(null)
  },

  buildContext: (groupId, currentMemberId) => window.oxe.integration.buildContext({ groupId, currentMemberId }),

  clearError: () => set({ error: null })
}))

function replaceGroup(group: IntegrationGroup, set: (partial: Partial<IntegrationState> | ((state: IntegrationState) => Partial<IntegrationState>)) => void): IntegrationGroup {
  set((state) => ({
    groups: state.groups.map((item) => item.id === group.id ? group : item),
    activeGroupId: group.id,
    activeMemberId: group.members.some((member) => member.id === state.activeMemberId)
      ? state.activeMemberId
      : group.members[0]?.id ?? null,
    error: null
  }))
  return group
}

function resolveMemberSelection(groups: IntegrationGroup[], activeGroupId: string | null, activeMemberId: string | null): string | null {
  const activeGroup = activeGroupId
    ? groups.find((group) => group.id === activeGroupId) ?? groups[0] ?? null
    : groups[0] ?? null
  if (!activeGroup) return null
  if (activeMemberId && activeGroup.members.some((member) => member.id === activeMemberId)) return activeMemberId
  return activeGroup.members[0]?.id ?? null
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected integration error'
}

/**
 * Locates the integration member matching this pane. Priority order:
 *   1. exact paneId match (the most specific binding — user explicitly
 *      attached this pane to a member);
 *   2. workspaceId match (less specific — any pane in that workspace
 *      inherits the member, useful when only one pane represents the repo).
 *
 * Returns { groupId, memberId } so the caller can call `buildContext` or
 * the slash dispatcher without re-scanning the group list. Null when this
 * pane isn't part of any integration — callers treat that as "no extra
 * context to inject".
 */
export function findMemberForPane(
  groups: IntegrationGroup[],
  workspaceId: string,
  paneId: string
): { groupId: string; memberId: string } | null {
  for (const group of groups) {
    const exact = group.members.find((member) => member.paneId === paneId)
    if (exact) return { groupId: group.id, memberId: exact.id }
  }
  for (const group of groups) {
    const byWorkspace = group.members.find((member) => member.workspaceId === workspaceId)
    if (byWorkspace) return { groupId: group.id, memberId: byWorkspace.id }
  }
  return null
}

/**
 * Selector for the sidebar badge: returns the integration groups this
 * workspace participates in (as a member of any group). Sorted by group
 * creation order — the same order the panel lists them, so the tooltip
 * reads consistently with the panel header.
 */
export function selectIntegrationsForWorkspace(workspaceId: string): (state: IntegrationState) => IntegrationGroup[] {
  return (state) => state.groups.filter((group) =>
    group.members.some((member) => member.workspaceId === workspaceId)
  )
}
