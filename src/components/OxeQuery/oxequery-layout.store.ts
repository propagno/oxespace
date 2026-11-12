import { useLayoutEffect, useState, type RefObject } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Sizes the person dragged in OxeQuery; the same for every connection. */
export const TREE_WIDTH = { min: 170, max: 520, default: 200 }
export const EDITOR_HEIGHT = { min: 80, default: 170 }
export const MONGO_INPUTS_HEIGHT = { min: 64, default: 112 }
/** The results keep at least this much height, whatever the editor is dragged to. */
export const RESULTS_MIN_HEIGHT = 120

interface LayoutState {
  treeWidth: number
  editorHeight: number
  mongoInputsHeight: number
  set(change: Partial<Pick<LayoutState, 'treeWidth' | 'editorHeight' | 'mongoInputsHeight'>>): void
}

export const useOxeQueryLayout = create<LayoutState>()(persist(set => ({
  treeWidth: TREE_WIDTH.default, editorHeight: EDITOR_HEIGHT.default, mongoInputsHeight: MONGO_INPUTS_HEIGHT.default,
  set: change => set(change)
}), { name: 'oxe.oxequery.layout', partialize: state => ({ treeWidth: state.treeWidth, editorHeight: state.editorHeight, mongoInputsHeight: state.mongoInputsHeight }) }))

/** The element's current height, kept up to date as the window or the panels around it change. */
export function useHeight(ref: RefObject<HTMLElement | null>, box: 'content' | 'border' = 'content'): number {
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setHeight(element.getBoundingClientRect().height)
    if (typeof ResizeObserver === 'undefined') return
    // 'border' is the box the layout gives the element (padding and border included): what a bar takes from its column.
    const observer = new ResizeObserver(([entry]) => setHeight(box === 'border' ? element.getBoundingClientRect().height : entry.contentRect.height))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, box])
  return height
}
