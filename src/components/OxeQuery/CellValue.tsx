import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SQL_NULL } from './grid-format'
import type { CellContent } from './grid-model'

const isContainer = (value: unknown): value is Record<string, unknown> | unknown[] => value !== null && typeof value === 'object'

function Primitive({ value }: { value: unknown }): ReactElement {
  if (value === null) return <span className="oq-json-null">{SQL_NULL.toLowerCase()}</span>
  if (typeof value === 'string') return <span className="oq-json-string">{JSON.stringify(value)}</span>
  return <span className={typeof value === 'number' ? 'oq-json-number' : 'oq-json-bool'}>{String(value)}</span>
}

/** One node of a JSON document; objects and arrays fold. `depth` is how many levels start open. */
function Node({ name, value, level, openDepth }: { name?: string; value: unknown; level: number; openDepth: number }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [open, setOpen] = useState(level < openDepth)
  const label = name === undefined ? null : <span className="oq-json-key">{name}: </span>
  if (!isContainer(value)) return <div className="oq-json-row">{label}<Primitive value={value} /></div>
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value)
  const brackets = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  return <div className="oq-json-node">
    <button type="button" className="oq-json-toggle" aria-expanded={open} aria-label={t(open ? 'cell.collapseNode' : 'cell.expandNode', { name: name ?? '$' })} onClick={() => setOpen(current => !current)}>
      {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}{label}{brackets[0]}{!open && <span className="oq-json-summary"> {t('cell.items', { count: entries.length })} </span>}{!open && brackets[1]}
    </button>
    {open && <div className="oq-json-children">
      {entries.map(([key, child]) => <Node key={key} name={key} value={child} level={level + 1} openDepth={openDepth} />)}
      <div className="oq-json-row">{brackets[1]}</div>
    </div>}
  </div>
}

/** A json / jsonb cell as a tree that can be folded, with one-click collapse or expand of everything. */
export function JsonTree({ data }: { data: unknown }): ReactElement {
  const { t } = useTranslation('oxequery')
  const [state, setState] = useState({ depth: 2, version: 0 })
  return <div className="oq-json">
    <div className="oq-json-tools">
      <button type="button" onClick={() => setState(current => ({ depth: 0, version: current.version + 1 }))}>{t('cell.collapseAll')}</button>
      <button type="button" onClick={() => setState(current => ({ depth: Infinity, version: current.version + 1 }))}>{t('cell.expandAll')}</button>
    </div>
    <div className="oq-json-tree" role="group" aria-label={t('cell.jsonLabel')}><Node key={state.version} value={data} level={0} openDepth={state.depth} /></div>
  </div>
}

/** An array cell as a numbered list. */
export function ArrayList({ items }: { items: (string | null)[] }): ReactElement {
  const { t } = useTranslation('oxequery')
  return <div className="oq-array">
    <small className="oq-muted">{t('cell.items', { count: items.length })}</small>
    <ol aria-label={t('cell.arrayLabel')} start={0}>
      {items.map((item, index) => <li key={index} className={item === null ? 'is-null' : undefined}>{item === null ? SQL_NULL : item}</li>)}
    </ol>
  </div>
}

/** The text a copy of the cell puts on the clipboard: pretty JSON, or the array as JSON. */
export function contentText(content: CellContent): string | null {
  if (content.kind === 'json') return JSON.stringify(content.data, null, 2)
  if (content.kind === 'array') return JSON.stringify(content.items)
  return null
}
