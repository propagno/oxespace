import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  if (!chords.length) return <span className={styles.unset}>{t('keys.notSet')}</span>
  return <span className={styles.chords}>
    {chords.map((chord, index) => <span key={chord} className={styles.chords}>
      {index > 0 && <span className={styles.or}>{t('keys.or')}</span>}<KeyChord chord={chord} />
    </span>)}
  </span>
}
