import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Pin, X } from 'lucide-react'
import { SQL_NULL, displayCell as plainCell, formatRows, normalizeRange, sliceRange, type CellRange, type CopyFormat } from './grid-format'
import { EMPTY_FILTER, isFiltering, pinColumns, pinOffsets, viewOrder, type GridFilter } from './grid-model'
import { Select } from '../../ui/Field'

// The formatters live in grid-format.ts; these stay importable from here.
export { displayCell, toCsv, toJsonRows, sortedOrder } from './grid-format'

const ROW_HEIGHT = 26
const OVERSCAN = 8
const MIN_WIDTH = 48
const PAGE_ROWS = 12
const INDEX_WIDTH = 56

interface Position { row: number; column: number }

/** A real NULL and the text "NULL" must not look alike. */
function shown(value: unknown): string {
  if (value === null || value === undefined) return SQL_NULL
  return value === SQL_NULL ? `"${SQL_NULL}"` : plainCell(value)
}

export interface GridSort { column: number; direction: 'asc' | 'desc' }

/**
 * A windowed table: only the rows in view are rendered, so a 10 000-row result costs the same as a
 * 40-row one. Row height is fixed for that reason.
 *
 * Keyboard: arrows, Home/End, PageUp/PageDown, Ctrl+Home/End move the active cell; Shift extends the
 * selection; Ctrl+A selects everything; Ctrl+C copies the selection (tab-separated, ready for a
 * spreadsheet); Enter opens the row; Escape clears. Dragging selects a block.
 *
 * Sorting: with `onSort` the server orders the rows (the grid shows the order it was given);
 * without it the loaded rows are sorted in place.
 *
 * Filtering and pinning work on the rows already loaded and never run the query again: a filter keeps the
 * rows whose text contains what was typed (in one column, or in any), and a pinned column sticks to the left.
 */
export function ResultGrid({ columns, types, rows, onCopy, onSelect, selected, onOpenCell, onSort, sort: controlledSort, tableName, label: labelProp }: {
  columns: string[]; types?: string[]; rows: unknown[][]; onCopy?: (text: string, format?: CopyFormat) => void
  /** Called with the original row index when a row is opened (click on its number, or Enter). */
  onSelect?: (index: number) => void
  selected?: number | null
  /** Called when a cell is opened (double-click). */
  onOpenCell?: (cell: { column: string; type?: string; value: unknown; row: number }) => void
  onSort?: (sort: GridSort | null) => void
  sort?: GridSort | null
  /** Quoted table name used by "Copy as INSERT". */
  tableName?: string
  label?: string
}): ReactElement {
  const { t } = useTranslation('oxequery')
  const label = labelProp ?? t('grid.label')
  const scroller = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(360)
  const [viewWidth, setViewWidth] = useState(0)
  const [localSort, setLocalSort] = useState<GridSort | null>(null)
  const sort = controlledSort !== undefined ? controlledSort : localSort
  const [overrides, setOverrides] = useState<Record<number, number>>({})
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const [pinned, setPinned] = useState<Set<number>>(new Set())
  const [filter, setFilter] = useState<GridFilter>(EMPTY_FILTER)
  const [filterColumn, setFilterColumn] = useState(-1)
  const [anchor, setAnchor] = useState<Position | null>(null)
  const [focus, setFocus] = useState<Position | null>(null)
  const dragging = useRef(false)

  // A different result starts with a clean slate: widths, hidden columns and selection belong to it.
  const identity = columns.join('\u0000')
  useEffect(() => { setOverrides({}); setHidden(new Set()); setPinned(new Set()); setFilter(EMPTY_FILTER); setFilterColumn(-1); setAnchor(null); setFocus(null) }, [identity])

  const visible = useMemo(() => pinColumns(columns.map((_, index) => index).filter(index => !hidden.has(index)), pinned), [columns, hidden, pinned])
  const autoWidths = useMemo(() => columns.map((name, index) => {
    const sample = rows.slice(0, 50).reduce((longest, row) => Math.max(longest, shown(row[index]).length), name.length)
    return Math.max(80, Math.min(sample * 8 + 24, 420))
  }), [columns, rows])
  const baseWidth = useCallback((index: number): number => overrides[index] ?? autoWidths[index], [overrides, autoWidths])
  // A narrow result fills the pane: the last column takes what the others leave.
  const naturalTotal = visible.reduce((sum, index) => sum + baseWidth(index), 0) + INDEX_WIDTH
  const extra = Math.max(0, viewWidth - naturalTotal)
  const lastVisible = visible[visible.length - 1]
  const widthOf = useCallback((index: number): number => baseWidth(index) + (index === lastVisible ? extra : 0), [baseWidth, lastVisible, extra])
  const order = useMemo(() => viewOrder(rows, filter, onSort ? null : sort), [rows, filter, sort, onSort])
  const count = order ? order.length : rows.length
  const pinLeft = useMemo(() => pinOffsets(visible, pinned, widthOf, INDEX_WIDTH), [visible, pinned, widthOf])
  const stickyStyle = (column: number, width: number): CSSProperties => (pinLeft.has(column) ? { width, position: 'sticky', left: pinLeft.get(column) } : { width })
  const total = naturalTotal + extra
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(count, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)

  const toggleSort = (column: number): void => {
    const next: GridSort | null = !sort || sort.column !== column ? { column, direction: 'asc' } : sort.direction === 'asc' ? { column, direction: 'desc' } : null
    if (controlledSort === undefined) setLocalSort(next)
    onSort?.(next)
  }

  const range: CellRange | null = anchor && focus ? normalizeRange(anchor, focus) : null
  const inRange = (row: number, column: number): boolean => Boolean(range && row >= range.rowStart && row <= range.rowEnd && column >= range.columnStart && column <= range.columnEnd)

  const copySelection = (format: CopyFormat = 'tsv'): void => {
    if (!range || !onCopy) return
    const cells = sliceRange(columns, rows, { ...range, columnStart: 0, columnEnd: columns.length - 1 }, order)
    // `range` counts visible columns; map them back to the real ones.
    const keep = visible.filter((_, position) => position >= range.columnStart && position <= range.columnEnd)
    onCopy(formatRows(format, keep.map(index => cells.columns[index]), cells.rows.map(row => keep.map(index => row[index])), tableName), format)
  }

  const reveal = (position: Position): void => {
    const element = scroller.current
    if (!element) return
    const top = (position.row + 1) * ROW_HEIGHT
    if (top - ROW_HEIGHT < element.scrollTop) element.scrollTop = top - ROW_HEIGHT
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top + ROW_HEIGHT - element.clientHeight
  }

  const move = (next: Position, extend: boolean): void => {
    const clamped = { row: Math.max(0, Math.min(count - 1, next.row)), column: Math.max(0, Math.min(visible.length - 1, next.column)) }
    setFocus(clamped)
    if (!extend || !anchor) setAnchor(clamped)
    reveal(clamped)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (count === 0 || visible.length === 0) return
    const current = focus ?? { row: 0, column: 0 }
    const extend = event.shiftKey
    const ctrl = event.ctrlKey || event.metaKey
    const handled = ((): boolean => {
      switch (event.key) {
        case 'ArrowDown': move({ ...current, row: current.row + 1 }, extend); return true
        case 'ArrowUp': move({ ...current, row: current.row - 1 }, extend); return true
        case 'ArrowRight': move({ ...current, column: current.column + 1 }, extend); return true
        case 'ArrowLeft': move({ ...current, column: current.column - 1 }, extend); return true
        case 'PageDown': move({ ...current, row: current.row + PAGE_ROWS }, extend); return true
        case 'PageUp': move({ ...current, row: current.row - PAGE_ROWS }, extend); return true
        case 'Home': move(ctrl ? { row: 0, column: 0 } : { ...current, column: 0 }, extend); return true
        case 'End': move(ctrl ? { row: count - 1, column: visible.length - 1 } : { ...current, column: visible.length - 1 }, extend); return true
        case 'Escape': setAnchor(null); setFocus(null); return true
        case 'Enter': onSelect?.(order ? order[current.row] : current.row); return true
        default: break
      }
      if (ctrl && event.key.toLowerCase() === 'a') { setAnchor({ row: 0, column: 0 }); setFocus({ row: count - 1, column: visible.length - 1 }); return true }
      if (ctrl && event.key.toLowerCase() === 'c') { copySelection(); return true }
      return false
    })()
    if (handled) event.preventDefault()
  }

  const startDrag = (position: Position, event: MouseEvent): void => {
    if (event.button !== 0) return
    dragging.current = true
    if (event.shiftKey && anchor) setFocus(position)
    else { setAnchor(position); setFocus(position) }
    scroller.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    const stop = (): void => { dragging.current = false }
    window.addEventListener('mouseup', stop)
    return () => window.removeEventListener('mouseup', stop)
  }, [])

  const beginResize = (index: number, event: MouseEvent): void => {
    event.stopPropagation(); event.preventDefault()
    const startX = event.clientX
    const startWidth = widthOf(index)
    const onMove = (pointer: globalThis.MouseEvent): void => setOverrides(current => ({ ...current, [index]: Math.max(MIN_WIDTH, startWidth + pointer.clientX - startX) }))
    const onUp = (): void => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp)
  }

  const activeRow = focus?.row ?? -1
  const filtering = isFiltering(filter)
  const setFilterText = (text: string): void => setFilter(current => filterColumn < 0 ? { ...current, text } : { ...current, columns: { ...current.columns, [filterColumn]: text } })
  const filterText = filterColumn < 0 ? filter.text : filter.columns[filterColumn] ?? ''
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; setScrollTop(0); setAnchor(null); setFocus(null) }, [filter])
  return <div className="oq-grid-wrap">
    <div className="oq-grid-filter" role="search" aria-label={t('grid.filterLabel')}>
      <Select className="oq-select" aria-label={t('grid.filterScope')} value={filterColumn} onChange={event => setFilterColumn(Number(event.target.value))}>
        <option value={-1}>{t('grid.filterAll')}</option>{columns.map((name, index) => <option key={`${name}:${index}`} value={index}>{name}</option>)}</Select>
      <input type="search" aria-label={t('grid.filterLabel')} placeholder={t('grid.filterPlaceholder')} value={filterText} spellCheck={false} onChange={event => setFilterText(event.target.value)} />
      {filtering && <><small className="oq-muted" role="status">{t('grid.filterCount', { shown: count, total: rows.length })}</small>
        <button type="button" className="oq-icon" aria-label={t('grid.filterClear')} onClick={() => setFilter(EMPTY_FILTER)}><X size={12} aria-hidden="true" /></button></>}
    </div>
    <div className="oq-grid" role="grid" aria-label={label} aria-rowcount={count + 1} aria-colcount={visible.length} aria-multiselectable="true" tabIndex={0}
    aria-activedescendant={focus ? `${label}-cell-${focus.row}-${focus.column}` : undefined} onKeyDown={onKeyDown}
    ref={element => { scroller.current = element; if (element && element.clientHeight && element.clientHeight !== height) setHeight(element.clientHeight); if (element && element.clientWidth !== viewWidth) setViewWidth(element.clientWidth) }}
    onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
    <div className="oq-grid-inner" style={{ width: total, height: (count + 1) * ROW_HEIGHT }}>
      <div className="oq-grid-header" role="row" style={{ width: total }}>
        <span className="oq-grid-index" role="columnheader">
          {hidden.size > 0 ? <button type="button" className="oq-grid-unhide" title={t('grid.hiddenTitle', { count: hidden.size })} aria-label={t('grid.showHidden', { count: hidden.size })} onClick={() => setHidden(new Set())}>+{hidden.size}</button> : '#'}
        </span>
        {visible.map(index => <span key={`${columns[index]}:${index}`} role="columnheader" className={pinned.has(index) ? 'is-pinned' : undefined} style={stickyStyle(index, widthOf(index))}
          title={t('grid.sortTitle', { column: types?.[index] ? `${columns[index]} · ${types[index]}` : columns[index] })}
          aria-sort={sort?.column === index ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={() => toggleSort(index)}>
          {columns[index]}{types?.[index] && <small>{types[index]}</small>}{sort?.column === index && <b aria-hidden="true">{sort.direction === 'asc' ? ' ▲' : ' ▼'}</b>}
          <button type="button" className={`oq-grid-pin${pinned.has(index) ? ' is-on' : ''}`} aria-pressed={pinned.has(index)} aria-label={t(pinned.has(index) ? 'grid.unpin' : 'grid.pin', { name: columns[index] })} title={t('grid.pinTitle')}
            onClick={event => { event.stopPropagation(); setPinned(current => { const next = new Set(current); if (!next.delete(index)) next.add(index); return next }) }}><Pin size={11} aria-hidden="true" /></button>
          {visible.length > 1 && <button type="button" className="oq-grid-hide" aria-label={t('grid.hideNamed', { name: columns[index] })} title={t('grid.hide')}
            onClick={event => { event.stopPropagation(); setHidden(current => new Set([...current, index])) }}>×</button>}
          <i className="oq-grid-resize" role="separator" aria-orientation="vertical" aria-label={t('grid.resize', { name: columns[index] })}
            onMouseDown={event => beginResize(index, event)} onClick={event => event.stopPropagation()}
            onDoubleClick={event => { event.stopPropagation(); setOverrides(current => { const next = { ...current }; delete next[index]; return next }) }} />
        </span>)}
      </div>
      {Array.from({ length: Math.max(0, end - start) }, (_, offset) => start + offset).map(position => {
        const index = order ? order[position] : position
        const row = rows[index]
        return <div key={position} className={`oq-grid-row${selected === index ? ' is-selected' : ''}${activeRow === position ? ' is-active' : ''}`} role="row" aria-rowindex={position + 2} style={{ top: (position + 1) * ROW_HEIGHT, width: total }}>
          <span className="oq-grid-index" role="rowheader" title={t('grid.openRow')} onClick={() => onSelect?.(index)}>{index + 1}</span>
          {visible.map((column, columnPosition) => {
            const value = row[column]
            const active = focus?.row === position && focus.column === columnPosition
            const classes = [pinLeft.has(column) ? 'is-pinned' : '', value === null || value === undefined ? 'is-null' : typeof value === 'number' ? 'is-number' : '', inRange(position, columnPosition) ? 'is-range' : '', active ? 'is-focus' : ''].filter(Boolean).join(' ')
            return <span key={`${columns[column]}:${column}`} id={`${label}-cell-${position}-${columnPosition}`} role="gridcell" aria-selected={inRange(position, columnPosition)}
              className={classes || undefined} style={stickyStyle(column, widthOf(column))} title={value === null || value === undefined ? t('grid.nullTitle') : plainCell(value).slice(0, 500)}
              onMouseDown={event => startDrag({ row: position, column: columnPosition }, event)}
              onMouseEnter={() => { if (dragging.current) setFocus({ row: position, column: columnPosition }) }}
              onDoubleClick={() => onOpenCell ? onOpenCell({ column: columns[column], ...(types?.[column] ? { type: types[column] } : {}), value, row: index }) : onCopy?.(plainCell(value))}>{shown(value)}</span>
          })}
        </div>
      })}
    </div>
  </div>
  </div>
}
