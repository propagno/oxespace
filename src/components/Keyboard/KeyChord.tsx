import type { ReactElement } from 'react'
import { Kbd } from '../../ui'
import { chordParts, formatChord } from '../../keyboard/chords'
import styles from './Keyboard.module.css'

/** One chord as key caps: Ctrl Shift D. */
export function KeyChord({ chord }: { chord: string }): ReactElement {
  return <span className={styles.chord} aria-label={formatChord(chord)}>
    {chordParts(chord).map((part, index) => <Kbd key={index}>{part}</Kbd>)}
  </span>
}

/** Every chord of a shortcut, or a quiet "Not set". */
export function KeyChords({ chords }: { chords: string[] }): ReactElement {
  if (!chords.length) return <span className={styles.unset}>Not set</span>
  return <span className={styles.chords}>
    {chords.map((chord, index) => <span key={chord} className={styles.chords}>
      {index > 0 && <span className={styles.or}>or</span>}<KeyChord chord={chord} />
    </span>)}
  </span>
}
