import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FileSystemFileChangedEvent } from '../../shared/types/ipc'
import { detectEditorLanguage } from '../components/Editor/language'
import { isBinaryPreview, previewKind } from '../components/Preview/previewKind'

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

/** Persisted per-tab metadata — content is never persisted, only re-read. */
export interface EditorTab {
  relativePath: string
  /** Pinned tabs sort first and survive "close others". */
  pinned: boolean
  /** Binary tabs render a preview instead of Monaco and are never read as text. */
  binary: boolean
}

interface OpenFileInput {
  workspaceId: string
  rootPath: string
  relativePath: string
}

interface EditorState {
  /** workspaceId → relativePath → loaded file. Only open tabs are kept. */
  files: Record<string, Record<string, EditorFileState>>
  /** workspaceId → ordered tab strip (persisted). */
  tabs: Record<string, EditorTab[]>
  /** workspaceId → active tab path (persisted). */
  activePath: Record<string, string | null>
  /** Opens (or re-activates) a tab. Activating a loaded tab never re-reads it. */
  openFile: (input: OpenFileInput) => Promise<void>
  closeTab: (workspaceId: string, relativePath: string) => void
  closeOtherTabs: (workspaceId: string, relativePath: string) => void
  togglePin: (workspaceId: string, relativePath: string) => void
  moveTab: (workspaceId: string, fromPath: string, toPath: string) => void
  /** Re-reads persisted tabs after a restart so the editor comes back as it was. */
  restoreSession: (workspaceId: string, rootPath: string) => Promise<void>
  updateContent: (workspaceId: string, content: string) => void
  saveFile: (workspaceId: string) => Promise<void>
  markExternalChange: (event: FileSystemFileChangedEvent) => void
  clearEditor: (workspaceId: string) => void
  hasDirtyEditor: (workspaceId: string) => boolean
}

/** Pinned tabs always sort ahead of unpinned ones, order preserved otherwise. */
function sortTabs(tabs: EditorTab[]): EditorTab[] {
  return [...tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned))
}

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
      files: {},
      tabs: {},
      activePath: {},

      openFile: async (input) => {
        const kind = previewKind(input.relativePath)
        const binary = isBinaryPreview(kind)
        // Re-opening an already-loaded tab just activates it: no re-read, so
        // unsaved edits survive tab switching.
        const alreadyLoaded = Boolean(get().files[input.workspaceId]?.[input.relativePath]?.watchId)

        set((state) => {
          const tabs = state.tabs[input.workspaceId] ?? []
          const nextTabs = tabs.some((tab) => tab.relativePath === input.relativePath)
            ? tabs
            : sortTabs([...tabs, { relativePath: input.relativePath, pinned: false, binary }])
          return {
            tabs: { ...state.tabs, [input.workspaceId]: nextTabs },
            activePath: { ...state.activePath, [input.workspaceId]: input.relativePath },
            files: {
              ...state.files,
              [input.workspaceId]: {
                ...(state.files[input.workspaceId] ?? {}),
                [input.relativePath]: {
                  ...(state.files[input.workspaceId]?.[input.relativePath] ?? {
                    content: '',
                    lastSavedContent: '',
                    watchId: null,
                    isSaving: false,
                    conflict: null
                  }),
                  workspaceId: input.workspaceId,
                  rootPath: input.rootPath,
                  relativePath: input.relativePath,
                  language: detectEditorLanguage(input.relativePath),
                  isLoading: !binary && !alreadyLoaded,
                  error: null
                } as EditorFileState
              }
            }
          }
        })

        // Binary tabs are rendered by the preview viewer, which reads them itself
        // over fs:read-binary — the utf-8 readFile below would corrupt them.
        if (binary || alreadyLoaded) return

        try {
          const result = await window.oxe.fs.readFile(input)
          const watch = await window.oxe.fs.watchFile(input)
          set((state) => {
            const current = state.files[input.workspaceId]?.[input.relativePath]
            if (!current) return state
            return {
              files: {
                ...state.files,
                [input.workspaceId]: {
                  ...state.files[input.workspaceId],
                  [input.relativePath]: {
                    ...current,
                    content: result.content,
                    lastSavedContent: result.content,
                    language: detectEditorLanguage(result.relativePath),
                    watchId: watch.watchId,
                    isLoading: false,
                    error: null,
                    conflict: null
                  }
                }
              }
            }
          })
        } catch (error) {
          set((state) => {
            const current = state.files[input.workspaceId]?.[input.relativePath]
            if (!current) return state
            return {
              files: {
                ...state.files,
                [input.workspaceId]: {
                  ...state.files[input.workspaceId],
                  [input.relativePath]: { ...current, isLoading: false, error: toMessage(error) }
                }
              }
            }
          })
        }
      },

      closeTab: (workspaceId, relativePath) => {
        const state = get()
        const file = state.files[workspaceId]?.[relativePath]
        if (file?.watchId) void window.oxe.fs.unwatchFile({ watchId: file.watchId }).catch(() => undefined)

        const tabs = (state.tabs[workspaceId] ?? []).filter((tab) => tab.relativePath !== relativePath)
        const nextFiles = { ...(state.files[workspaceId] ?? {}) }
        delete nextFiles[relativePath]

        let nextActive = state.activePath[workspaceId] ?? null
        if (nextActive === relativePath) {
          const previousIndex = (state.tabs[workspaceId] ?? []).findIndex((tab) => tab.relativePath === relativePath)
          nextActive = tabs[Math.min(previousIndex, tabs.length - 1)]?.relativePath ?? null
        }

        set({
          tabs: { ...state.tabs, [workspaceId]: tabs },
          files: { ...state.files, [workspaceId]: nextFiles },
          activePath: { ...state.activePath, [workspaceId]: nextActive }
        })
      },

      closeOtherTabs: (workspaceId, relativePath) => {
        const state = get()
        const keep = new Set(
          (state.tabs[workspaceId] ?? [])
            .filter((tab) => tab.pinned || tab.relativePath === relativePath)
            .map((tab) => tab.relativePath)
        )
        for (const [path, file] of Object.entries(state.files[workspaceId] ?? {})) {
          if (keep.has(path)) continue
          if (file.watchId) void window.oxe.fs.unwatchFile({ watchId: file.watchId }).catch(() => undefined)
        }
        const nextFiles = Object.fromEntries(
          Object.entries(state.files[workspaceId] ?? {}).filter(([path]) => keep.has(path))
        )
        set({
          tabs: { ...state.tabs, [workspaceId]: (state.tabs[workspaceId] ?? []).filter((tab) => keep.has(tab.relativePath)) },
          files: { ...state.files, [workspaceId]: nextFiles },
          activePath: { ...state.activePath, [workspaceId]: relativePath }
        })
      },

      togglePin: (workspaceId, relativePath) => {
        set((state) => ({
          tabs: {
            ...state.tabs,
            [workspaceId]: sortTabs(
              (state.tabs[workspaceId] ?? []).map((tab) =>
                tab.relativePath === relativePath ? { ...tab, pinned: !tab.pinned } : tab
              )
            )
          }
        }))
      },

      moveTab: (workspaceId, fromPath, toPath) => {
        set((state) => {
          const tabs = state.tabs[workspaceId] ?? []
          const fromIndex = tabs.findIndex((tab) => tab.relativePath === fromPath)
          const toIndex = tabs.findIndex((tab) => tab.relativePath === toPath)
          if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return state
          const next = [...tabs]
          const [moved] = next.splice(fromIndex, 1)
          next.splice(toIndex, 0, moved)
          return { tabs: { ...state.tabs, [workspaceId]: sortTabs(next) } }
        })
      },

      restoreSession: async (workspaceId, rootPath) => {
        const state = get()
        const tabs = state.tabs[workspaceId] ?? []
        if (tabs.length === 0) return
        const active = state.activePath[workspaceId] ?? tabs[0].relativePath
        // Only the active tab is read eagerly; the rest load when activated.
        const target = tabs.find((tab) => tab.relativePath === active) ?? tabs[0]
        if (state.files[workspaceId]?.[target.relativePath]) return
        await get().openFile({ workspaceId, rootPath, relativePath: target.relativePath })
      },

      updateContent: (workspaceId, content) => {
        set((state) => {
          const path = state.activePath[workspaceId]
          const file = path ? state.files[workspaceId]?.[path] : null
          if (!path || !file) return state
          return {
            files: {
              ...state.files,
              [workspaceId]: { ...state.files[workspaceId], [path]: { ...file, content } }
            }
          }
        })
      },

      saveFile: async (workspaceId) => {
        const path = get().activePath[workspaceId]
        const file = path ? get().files[workspaceId]?.[path] : null
        if (!path || !file) return

        set((state) => ({
          files: {
            ...state.files,
            [workspaceId]: { ...state.files[workspaceId], [path]: { ...file, isSaving: true, error: null } }
          }
        }))
        try {
          await window.oxe.fs.writeFile({
            workspaceId: file.workspaceId,
            rootPath: file.rootPath,
            relativePath: file.relativePath,
            content: file.content
          })
          set((state) => {
            const current = state.files[workspaceId]?.[path]
            if (!current) return state
            return {
              files: {
                ...state.files,
                [workspaceId]: {
                  ...state.files[workspaceId],
                  [path]: { ...current, lastSavedContent: current.content, isSaving: false, error: null, conflict: null }
                }
              }
            }
          })
        } catch (error) {
          set((state) => {
            const current = state.files[workspaceId]?.[path]
            if (!current) return state
            return {
              files: {
                ...state.files,
                [workspaceId]: {
                  ...state.files[workspaceId],
                  [path]: { ...current, isSaving: false, error: toMessage(error) }
                }
              }
            }
          })
        }
      },

      markExternalChange: (event) => {
        set((state) => {
          for (const [workspaceId, workspaceFiles] of Object.entries(state.files)) {
            const entry = Object.entries(workspaceFiles).find(([, file]) => file.watchId === event.watchId)
            if (!entry) continue
            const [path, file] = entry
            const isDirty = file.content !== file.lastSavedContent
            return {
              files: {
                ...state.files,
                [workspaceId]: {
                  ...workspaceFiles,
                  [path]: isDirty
                    ? { ...file, conflict: { externalContent: event.content, externalMtimeMs: event.mtimeMs } }
                    : { ...file, content: event.content, lastSavedContent: event.content, conflict: null }
                }
              }
            }
          }
          return state
        })
      },

      clearEditor: (workspaceId) => {
        for (const file of Object.values(get().files[workspaceId] ?? {})) {
          if (file.watchId) void window.oxe.fs.unwatchFile({ watchId: file.watchId })
        }
        set((state) => {
          const nextFiles = { ...state.files }
          const nextTabs = { ...state.tabs }
          const nextActive = { ...state.activePath }
          delete nextFiles[workspaceId]
          delete nextTabs[workspaceId]
          delete nextActive[workspaceId]
          return { files: nextFiles, tabs: nextTabs, activePath: nextActive }
        })
      },

      hasDirtyEditor: (workspaceId) =>
        Object.values(get().files[workspaceId] ?? {}).some((file) => file.content !== file.lastSavedContent)
    }),
    {
      name: 'oxe-editor-tabs-v1',
      // Content is deliberately not persisted: it would go stale against disk and
      // bloat localStorage. Only the strip is restored, then re-read from disk.
      partialize: (state) => ({ tabs: state.tabs, activePath: state.activePath })
    }
  )
)

/** The file backing the active tab of a workspace, if any. */
export function selectActiveFile(state: EditorState, workspaceId: string): EditorFileState | null {
  const path = state.activePath[workspaceId]
  return path ? state.files[workspaceId]?.[path] ?? null : null
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected editor error'
}
