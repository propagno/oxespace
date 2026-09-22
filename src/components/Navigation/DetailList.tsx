import './DetailList.css'

/** Shared read-only metadata presentation for Code and Thread. */
export function DetailList({ rows }: { rows: { label: string; detail?: string }[] }) {
  return <dl className="desktop-detail-list">{rows.map((row, index) => <div key={`${row.label}-${index}`}><dt>{row.label}</dt><dd>{row.detail || '—'}</dd></div>)}</dl>
}
