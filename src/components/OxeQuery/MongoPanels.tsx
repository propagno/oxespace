import type { ReactElement } from 'react'
import type { MongoExplainSummary } from '../../../shared/types/oxequery'
import { Button } from '../../ui'
import { isBranch, leafText } from './mongo-model'
import styles from './MongoPanels.module.css'
/** One document as a tree: objects and arrays open and close, typed values keep their type. */
export function DocumentTree({ text, open = 1 }: { text: string; open?: number }): ReactElement {
  let value: unknown
  try { value = JSON.parse(text) } catch { return <pre className={styles.raw}>{text}</pre> }
  return <div className={styles.tree} role="tree" aria-label="Document"><TreeNode name={null} value={value} depth={0} open={open} /></div>
}

function TreeNode({ name, value, depth, open }: { name: string | null; value: unknown; depth: number; open: number }): ReactElement {
  const label = name === null ? null : <span className={styles.key}>{name}: </span>
  if (!isBranch(value)) {
    const leaf = leafText(value)
    return <div role="treeitem" aria-level={depth + 1} className={styles.leaf}>{label}<span className={styles[leaf.kind]}>{leaf.text}</span></div>
  }
  const entries: Array<[string, unknown]> = Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value as Record<string, unknown>)
  const brackets = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`
  return <details className={styles.branch} open={depth < open} role="treeitem" aria-level={depth + 1}>
    <summary>{label}<span className={styles.count}>{brackets}</span></summary>
    <div className={styles.children} role="group">{entries.map(([key, child]) => <TreeNode key={key} name={key} value={child} depth={depth + 1} open={open} />)}</div>
  </details>
}

/** What the planner said, in words, with the raw answer one click away. */
export function ExplainCard({ explain, onClose }: { explain: MongoExplainSummary; onClose: () => void }): ReactElement {
  const scan = explain.stage === 'COLLSCAN'
  return <section className={styles.explain} aria-label="Query plan">
    <header><strong>Query plan</strong><Button size="sm" variant="ghost" onClick={onClose}>Close</Button></header>
    <dl className={styles.facts}>
      <div><dt>Access</dt><dd data-warn={scan || undefined}>{explain.stage}{explain.index ? ` on ${explain.index}` : ''}</dd></div>
      {explain.docsExamined !== undefined && <div><dt>Documents read</dt><dd>{explain.docsExamined}</dd></div>}
      {explain.keysExamined !== undefined && <div><dt>Index keys read</dt><dd>{explain.keysExamined}</dd></div>}
      {explain.returned !== undefined && <div><dt>Returned</dt><dd>{explain.returned}</dd></div>}
      {explain.timeMs !== undefined && <div><dt>Server time</dt><dd>{explain.timeMs} ms</dd></div>}
    </dl>
    {explain.warnings.length > 0 && <ul className={styles.warnings}>{explain.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    <details><summary>Full plan</summary><pre className={styles.raw}>{explain.raw}</pre></details>
  </section>
}

