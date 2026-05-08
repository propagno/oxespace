import { create } from 'zustand'
import type { FileSystemFileChangedEvent } from '../../shared/types/ipc'
import { detectEditorLanguage } from '../components/Editor/language'

interface EditorConflict {
  externalContent: string
  externalMtimeMs: number
}

export interface EditorFileState {
  workspaceId: string
  rootPath: string
  relativePath: string
  content: string
  lastSavedContent: string
  language: string
  watchId: string | null
  isLoading: boolean
  isSaving: boolean
  error: string | null
  conflict: EditorConflict | null
}

interface OpenFileInput {
  workspaceId: string
  rootPath: string
  relativePath: string
}

interface EditorState {
  files: Record<string, EditorFileState>
  openFile: (input: OpenFileInput) => Promise<void>
  updateContent: (workspaceId: string, content: string) => void
  saveFile: (workspaceId: string) => Promise<void>
  markExternalChange: (event: FileSystemFileChangedEvent) => void
  clearEditor: (workspaceId: string) => void
  hasDirtyEditor: (workspaceId: string) => boolean
}

export const useEditorStore = create<EditorState>((set, get) => ({
  files: {},

  openFile: async (input) => {
    const existing = get().files[input.workspaceId]
    if (existing?.watchId) {
      await window.oxe.fs.unwatchFile({ watchId: existing.watchId }).catch(() => undefined)
    }

    set((state) => ({
      files: {
        ...state.files,
        [input.workspaceId]: {
          workspaceId: input.workspaceId,
          rootPath: input.rootPath,
          relativePath: input.relativePath,
          content: '',
          lastSavedContent: '',
          language: detectEditorLanguage(input.relativePath),
          watchId: null,
          isLoading: true,
          isSaving: false,
          error: null,
          conflict: null
        }
      }
    }))

    try {
      const result = await window.oxe.fs.readFile(input)
      const watch = await window.oxe.fs.watchFile(input)
      set((state) => ({
        files: {
          ...state.files,
          [input.workspaceId]: {
            ...state.files[input.workspaceId],
            content: result.content,
            lastSavedContent: result.content,
            language: detectEditorLanguage(result.relativePath),
            relativePath: result.relativePath,
            watchId: watch.watchId,
            isLoading: false,
            error: null,
            conflict: null
          }
        }
      }))
    } catch (error) {
      set((state) => ({
        files: {
          ...state.files,
          [input.workspaceId]: {
            ...state.files[input.workspaceId],
            isLoading: false,
            error: toMessage(error)
          }
        }
      }))
    }
  },

  updateContent: (workspaceId, content) => {
    set((state) => {
      const file = state.files[workspaceId]
      if (!file) return state
      return {
        files: {
          ...state.files,
          [workspaceId]: { ...file, content }
        }
      }
    })
  },

  saveFile: async (workspaceId) => {
    const file = get().files[workspaceId]
    if (!file) return

    set((state) => ({ files: { ...state.files, [workspaceId]: { ...file, isSaving: true, error: null } } }))
    try {
      await window.oxe.fs.writeFile({
        workspaceId: file.workspaceId,
        rootPath: file.rootPath,
        relativePath: file.relativePath,
        content: file.content
      })
      set((state) => ({
        files: {
          ...state.files,
          [workspaceId]: {
            ...state.files[workspaceId],
            lastSavedContent: state.files[workspaceId].content,
            isSaving: false,
            error: null,
            conflict: null
          }
        }
      }))
    } catch (error) {
      set((state) => ({
        files: {
          ...state.files,
          [workspaceId]: { ...state.files[workspaceId], isSaving: false, error: toMessage(error) }
        }
      }))
    }
  },

  markExternalChange: (event) => {
    set((state) => {
      const entry = Object.entries(state.files).find(([, file]) => file.watchId === event.watchId)
      if (!entry) return state
      const [workspaceId, file] = entry
      const isDirty = file.content !== file.lastSavedContent

      return {
        files: {
          ...state.files,
          [workspaceId]: isDirty
            ? {
                ...file,
                conflict: {
                  externalContent: event.content,
                  externalMtimeMs: event.mtimeMs
                }
              }
            : {
                ...file,
                content: event.content,
                lastSavedContent: event.content,
                conflict: null
              }
        }
      }
    })
  },

  clearEditor: (workspaceId) => {
    const file = get().files[workspaceId]
    if (file?.watchId) {
      void window.oxe.fs.unwatchFile({ watchId: file.watchId })
    }
    set((state) => {
      const nextFiles = { ...state.files }
      delete nextFiles[workspaceId]
      return { files: nextFiles }
    })
  },

  hasDirtyEditor: (workspaceId) => {
    const file = get().files[workspaceId]
    return Boolean(file && file.content !== file.lastSavedContent)
  }
}))

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected editor error'
}
