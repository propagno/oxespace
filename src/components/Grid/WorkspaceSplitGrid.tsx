import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react'
import type { AgentProfile } from '../../../shared/types/agent'
import type { Workspace } from '../../../shared/types/workspace'
import { computeLayout, type LeafRect, type PaneNode, type ResizeHandle, type SplitDirection } from '../../../shared/types/pane-tree'
import { PaneContainer } from './PaneContainer'

type DropZone = 'left' | 'right' | 'top' | 'bottom'

interface DragState {
  paneId: string
  target: { paneId: string; zone: DropZone } | null
}

interface WorkspaceSplitGridProps {
  workspace: Workspace
  tree: PaneNode | null
  agentProfiles?: AgentProfile[]
  maximizedPaneId: string | null
  activePaneId?: string | null
  onClosePane?: (paneId: string) => void
  onToggleMaximize: (paneId: string) => void
  onSplitPane?: (paneId: string, direction: 'vertical' | 'horizontal') => void
  onActivatePane?: (paneId: string) => void
  onResize: (path: number[], index: number, deltaPct: number) => void
  /** Drag-to-split drop: relocate `paneId` beside `targetPaneId`. */
  onMovePane: (paneId: string, targetPaneId: string, direction: SplitDirection, after: boolean) => void
}

/** Which pane rect contains the (xPct, yPct) point, and which edge quadrant. */
function hitTest(rects: LeafRect[], xPct: number, yPct: number): { paneId: string; zone: DropZone } | null {
  const rect = rects.find(
    (r) => xPct >= r.left && xPct <= r.left + r.width && yPct >= r.top && yPct <= r.top + r.height
  )
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  const rx = (xPct - rect.left) / rect.width
  const ry = (yPct - rect.top) / rect.height
  const distances: Array<[DropZone, number]> = [
    ['left', rx],
    ['right', 1 - rx],
    ['top', ry],
    ['bottom', 1 - ry]
  ]
  distances.sort((a, b) => a[1] - b[1])
  return { paneId: rect.paneId, zone: distances[0][0] }
}

const ZONE_TO_OP: Record<DropZone, { direction: SplitDirection; after: boolean }> = {
  left: { direction: 'horizontal', after: false },
  right: { direction: 'horizontal', after: true },
  top: { direction: 'vertical', after: false },
  bottom: { direction: 'vertical', after: true }
}

/**
 * F2 · recursive split-tree workspace layout (Orca "Split Anything").
 *
 * Panes are rendered as a FLAT, paneId-keyed sibling list, absolutely positioned
 * from `computeLayout(tree)`. Because a pane keeps its React identity regardless
 * of the tree's shape, splitting or resizing never remounts its PaneContainer —
 * the terminal (xterm scrollback / alt-screen) is preserved. The `TerminalView`
 * is untouched; the shipped fixed grid is unchanged.
 */
export function WorkspaceSplitGrid({
  workspace,
  tree,
  agentProfiles = [],
  maximizedPaneId,
  activePaneId,
  onClosePane,
  onToggleMaximize,
  onSplitPane,
  onActivatePane,
  onResize,
  onMovePane
}: WorkspaceSplitGridProps): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const { rects, handles } = useMemo(() => computeLayout(tree), [tree])
  const paneById = useMemo(
    () => new Map(workspace.panes.map((p) => [p.id, p] as const)),
    [workspace.panes]
  )
  const isMaximized = Boolean(maximizedPaneId)

  // Window-level listeners during a drag: a 6px handle can't keep the pointer, so
  // capturing moves globally is more reliable than setPointerCapture.
  const beginDrag = (handle: ResizeHandle) => (e: ReactPointerEvent<HTMLDivElement>): void => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    const horizontal = handle.direction === 'horizontal'
    let last = horizontal ? e.clientX : e.clientY
    const containerPx = horizontal ? box.width : box.height
    const onMove = (ev: PointerEvent): void => {
      const current = horizontal ? ev.clientX : ev.clientY
      const axisPx = current - last
      if (containerPx <= 0 || axisPx === 0) return
      onResize(handle.path, handle.index, (axisPx * 10_000) / (containerPx * handle.extent))
      last = current
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Drag-to-split: grip pointerdown → track the pointer as container %, hit-test
  // the pane rects for target + edge zone, and relocate the leaf on drop. Same
  // window-listener pattern as resize; the tree doesn't change mid-drag, so the
  // captured rects stay valid.
  const beginPaneDrag = (paneId: string) => (e: ReactPointerEvent<HTMLDivElement>): void => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box || box.width <= 0 || box.height <= 0) return
    e.preventDefault()
    e.stopPropagation()
    let latest: DragState = { paneId, target: null }
    setDrag(latest)
    const onMove = (ev: PointerEvent): void => {
      const xPct = ((ev.clientX - box.left) / box.width) * 100
      const yPct = ((ev.clientY - box.top) / box.height) * 100
      const hit = hitTest(rects, xPct, yPct)
      latest = { paneId, target: hit && hit.paneId !== paneId ? hit : null }
      setDrag(latest)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (latest.target) {
        const op = ZONE_TO_OP[latest.target.zone]
        onMovePane(paneId, latest.target.paneId, op.direction, op.after)
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Translucent preview over the half of the target pane the drop would occupy.
  const previewStyle = useMemo((): CSSProperties | null => {
    if (!drag?.target) return null
    const rect = rects.find((r) => r.paneId === drag.target?.paneId)
    if (!rect) return null
    const { zone } = drag.target
    const half: CSSProperties =
      zone === 'left'
        ? { left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width / 2}%`, height: `${rect.height}%` }
        : zone === 'right'
          ? { left: `${rect.left + rect.width / 2}%`, top: `${rect.top}%`, width: `${rect.width / 2}%`, height: `${rect.height}%` }
          : zone === 'top'
            ? { left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height / 2}%` }
            : { left: `${rect.left}%`, top: `${rect.top + rect.height / 2}%`, width: `${rect.width}%`, height: `${rect.height / 2}%` }
    return half
  }, [drag, rects])

  return (
    <div
      ref={containerRef}
      className="workspace-split-grid"
      data-testid="workspace-split-grid"
      data-maximized-pane={maximizedPaneId ?? undefined}
    >
      {rects.map((r) => {
        const pane = paneById.get(r.paneId)
        if (!pane) return null
        const focused = pane.id === maximizedPaneId
        const style: CSSProperties = isMaximized
          ? focused
            ? { left: 0, top: 0, width: '100%', height: '100%', zIndex: 2 }
            : { left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%`, visibility: 'hidden', pointerEvents: 'none' }
          : { left: `${r.left}%`, top: `${r.top}%`, width: `${r.width}%`, height: `${r.height}%` }
        return (
          <div
            key={r.paneId}
            className={`split-pane-slot${drag?.paneId === r.paneId ? ' split-pane-slot--dragging' : ''}`}
            style={style}
          >
            <PaneContainer
              pane={pane}
              workspace={workspace}
              agentProfile={getAgentProfile(agentProfiles, pane.agentProfileId)}
              autoStart={workspace.autoStart}
              isMaximized={focused}
              isActive={pane.id === activePaneId}
              onClose={onClosePane}
              onToggleMaximize={onToggleMaximize}
              onActivate={onActivatePane}
              onSplitVertical={(id) => onSplitPane?.(id, 'vertical')}
              onSplitHorizontal={(id) => onSplitPane?.(id, 'horizontal')}
            />
            {!isMaximized && rects.length > 1 ? (
              <div
                className="split-drag-grip"
                data-testid="split-drag-grip"
                title="Arrastar para reposicionar"
                onPointerDown={beginPaneDrag(r.paneId)}
              />
            ) : null}
          </div>
        )
      })}

      {previewStyle ? (
        <div className="split-drop-preview" data-testid="split-drop-preview" style={previewStyle} />
      ) : null}

      {!isMaximized &&
        handles.map((h, i) => {
          const horizontal = h.direction === 'horizontal'
          const style: CSSProperties = horizontal
            ? { left: `calc(${h.left}% - 3px)`, top: `${h.top}%`, width: '6px', height: `${h.height}%`, cursor: 'col-resize' }
            : { left: `${h.left}%`, top: `calc(${h.top}% - 3px)`, width: `${h.width}%`, height: '6px', cursor: 'row-resize' }
          return (
            <div
              key={`handle-${h.path.join('.')}-${h.index}-${i}`}
              className="split-resize-handle"
              data-testid="split-resize-handle"
              style={style}
              onPointerDown={beginDrag(h)}
            />
          )
        })}
    </div>
  )
}

function getAgentProfile(agentProfiles: AgentProfile[], agentProfileId: string | null): AgentProfile | null {
  if (!agentProfileId) return null
  return agentProfiles.find((profile) => profile.agentProfileId === agentProfileId) ?? null
}
