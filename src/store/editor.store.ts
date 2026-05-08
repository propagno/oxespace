import { create } from 'zustand'
import type { FileSystemFileChangedEvent } from '../../shared/types/ipc'
import { detectEditorLanguage } from '../components/Editor/language'

interface EditorConflict {
  externalContent: string
  externalMtimeMs: number
}

export interface EditorFileState {
  paneId: string
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
  paneId: string
  workspaceId: string
  rootPath: string
  relativePath: string
}

interface EditorState {
  files: Record<string, EditorFileState>
  openFile: (input: OpenFileInput) => Promise<void>
  updateContent: (paneId: string, content: string) => void
  saveFile: (paneId: string) => Promise<void>
  markExternalChange: (event: FileSystemFileChangedEvent) => void
  clearEditor: (paneId: string) => void
  hasDirtyEditor: (paneId: string) => boolean
}

export const useEditorStore = create<EditorState>((set, get) => ({
  files: {},

  openFile: async (input) => {
    const existing = get().files[input.paneId]
    if (existing?.watchId) {
      await window.oxe.fs.unwatchFile({ watchId: existing.watchId }).catch(() => undefined)
    }

    set((state) => ({
      files: {
        ...state.files,
        [input.paneId]: {
          paneId: input.paneId,
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
          [input.paneId]: {
            ...state.files[input.paneId],
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
          [input.paneId]: {
            ...state.files[input.paneId],
            isLoading: false,
            error: toMessage(error)
          }
        }
      }))
    }
  },

  updateContent: (paneId, content) => {
    set((state) => {
      const file = state.files[paneId]
      if (!file) return state
      return {
        files: {
          ...state.files,
          [paneId]: { ...file, content }
        }
      }
    })
  },

  saveFile: async (paneId) => {
    const file = get().files[paneId]
    if (!file) return

    set((state) => ({ files: { ...state.files, [paneId]: { ...file, isSaving: true, error: null } } }))
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
          [paneId]: {
            ...state.files[paneId],
            lastSavedContent: state.files[paneId].content,
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
          [paneId]: { ...state.files[paneId], isSaving: false, error: toMessage(error) }
        }
      }))
    }
  },

  markExternalChange: (event) => {
    set((state) => {
      const entry = Object.entries(state.files).find(([, file]) => file.watchId === event.watchId)
      if (!entry) return state
      const [paneId, file] = entry
      const isDirty = file.content !== file.lastSavedContent

      return {
        files: {
          ...state.files,
          [paneId]: isDirty
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

  clearEditor: (paneId) => {
    const file = get().files[paneId]
    if (file?.watchId) {
      void window.oxe.fs.unwatchFile({ watchId: file.watchId })
    }
    set((state) => {
      const nextFiles = { ...state.files }
      delete nextFiles[paneId]
      return { files: nextFiles }
    })
  },

  hasDirtyEditor: (paneId) => {
    const file = get().files[paneId]
    return Boolean(file && file.content !== file.lastSavedContent)
  }
}))

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected editor error'
}
