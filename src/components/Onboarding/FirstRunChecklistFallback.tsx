import type { ReactElement } from 'react'
import { Skeleton } from '../../ui'
import styles from './FirstRunChecklist.module.css'

/** Holds the checklist's place on the start screen while its chunk loads, so nothing moves when it arrives. */
export function FirstRunChecklistFallback(): ReactElement {
  return <div className={`${styles.card} ${styles.fallback}`} aria-hidden="true"><Skeleton decorative lines={6} /></div>
}
