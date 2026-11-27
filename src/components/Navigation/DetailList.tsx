import type { ReactNode } from 'react'
import './DetailList.css'

/** Shared read-only metadata presentation for Code and Thread. */
export function DetailList({ rows }: { rows: { label: string; detail?: ReactNode }[] }) {
  return (
    <dl className="desktop-detail-list">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`}>
          <dt>{row.label}</dt>
          <dd>{row.detail === undefined || row.detail === null || row.detail === '' ? '—' : row.detail}</dd>
        </div>
      ))}
    </dl>
  )
}
