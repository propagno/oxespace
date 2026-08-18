import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DiffComment, DiffSide } from '../../shared/types/diff-comments'

interface AddCommentInput {
  workspaceId: string
  filePath: string
  side: DiffSide
  lineNo: number
  lineContent: string
  body: string
}

interface DiffCommentsState {
  /** All comments across workspaces (filter by workspaceId at the call site). */
  comments: DiffComment[]
  add: (input: AddCommentInput) => void
  remove: (id: string) => void
  clear: (workspaceId: string) => void
}

export const useDiffCommentsStore = create<DiffCommentsState>()(
  persist(
    (set) => ({
      comments: [],

      add: (input) =>
        set((state) => ({
          comments: [
            ...state.comments,
            {
              id: `dc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              createdAt: Date.now(),
              ...input
            }
          ]
        })),

      remove: (id) => set((state) => ({ comments: state.comments.filter((c) => c.id !== id) })),

      clear: (workspaceId) =>
        set((state) => ({ comments: state.comments.filter((c) => c.workspaceId !== workspaceId) }))
    }),
    { name: 'oxe-diff-comments-v1' }
  )
)
