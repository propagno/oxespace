import { useMemo, useRef, useState, type ReactElement } from 'react'

const ROW_HEIGHT = 26
const OVERSCAN = 8

export function displayCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  return typeof value === 'string' ? value : String(value)
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(columns: string[], rows: unknown[][]): string {
  return [columns.map(csvCell).join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\n')
}

export function toJsonRows(columns: string[], rows: unknown[][]): string {
  return JSON.stringify(rows.map(row => Object.fromEntries(columns.map((name, index) => [name, row[index]]))), null, 2)
}

/**
 * A windowed table: only the rows in view are rendered, so a 10 000-row result
 * costs the same as a 40-row one. Row height is fixed for that reason.
 */
export function ResultGrid({ columns, types, rows, onCopy }: { columns: string[]; types?: string[]; rows: unknown[][]; onCopy?: (text: string) => void }): ReactElement {
  const scroller = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(360)
  const widths = useMemo(() => columns.map((name, index) => {
    const sample = rows.slice(0, 50).reduce((longest, row) => Math.max(longest, displayCell(row[index]).length), name.length)
    return Math.max(80, Math.min(sample * 8 + 24, 420))
  }), [columns, rows])
  const total = widths.reduce((sum, width) => sum + width, 0) + 56
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)

  return <div className="oq-grid" role="table" aria-rowcount={rows.length + 1} aria-colcount={columns.length}
    ref={element => { scroller.current = element; if (element && element.clientHeight && element.clientHeight !== height) setHeight(element.clientHeight) }}
    onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
    <div className="oq-grid-inner" style={{ width: total, height: (rows.length + 1) * ROW_HEIGHT }}>
      <div className="oq-grid-header" role="row" style={{ width: total }}>
        <span className="oq-grid-index" role="columnheader">#</span>
        {columns.map((name, index) => <span key={`${name}:${index}`} role="columnheader" style={{ width: widths[index] }} title={types?.[index] ? `${name} · ${types[index]}` : name}>
          {name}{types?.[index] && <small>{types[index]}</small>}
        </span>)}
      </div>
      {rows.slice(start, end).map((row, offset) => {
        const index = start + offset
        return <div key={index} className="oq-grid-row" role="row" style={{ top: (index + 1) * ROW_HEIGHT, width: total }}>
          <span className="oq-grid-index" role="cell">{index + 1}</span>
          {columns.map((name, column) => {
            const value = row[column]
            return <span key={`${name}:${column}`} role="cell" className={value === null || value === undefined ? 'is-null' : undefined} style={{ width: widths[column] }}
              title={displayCell(value).slice(0, 500)} onDoubleClick={() => onCopy?.(displayCell(value))}>{displayCell(value)}</span>
          })}
        </div>
      })}
    </div>
  </div>
}
