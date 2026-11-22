import { useState } from 'react'
import { useNavigationPrefs } from '../store/navigation-prefs.store'
import { useThreadStore } from '../store/thread.store'

/** Makes a folder step 1's: the step is done and the folder is a project the first conversation can open in. */
export async function completeFolderStep(rootPath: string): Promise<void> {
  useNavigationPrefs.getState().completeFirstRunStep('folder')
  if (!window.oxe?.thread?.addProject) return
  // The step stands without the project: the first conversation then starts from the folder's path.
  await window.oxe.thread.addProject(rootPath).catch(() => undefined)
  await useThreadStore.getState().loadProjects().catch(() => undefined)
}

export interface FirstRunLaunch {
  /** The first run stays on screen with the workspace it makes. */
  kept: boolean
  /** That workspace's folder, shown by step 1. */
  folder: string | null
  create: <T extends { rootPath: string }>(fromFirstRun: boolean, createWorkspace: () => Promise<T>) => Promise<T>
}

/** A workspace made from the first run leaves the person there, at step 2 (OXE-331). */
export function useFirstRunLaunch(): FirstRunLaunch {
  const [kept, setKept] = useState(false)
  const [folder, setFolder] = useState<string | null>(null)
  return {
    kept,
    folder,
    create: async (fromFirstRun, createWorkspace) => {
      if (!fromFirstRun) return createWorkspace()
      // Before the call: the store publishes the workspace before the call returns.
      setKept(true)
      try {
        const workspace = await createWorkspace()
        setFolder(workspace.rootPath)
        void completeFolderStep(workspace.rootPath)
        return workspace
      } catch (error) {
        setKept(kept)
        throw error
      }
    }
  }
}
