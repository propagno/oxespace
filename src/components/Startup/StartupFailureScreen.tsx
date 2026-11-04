import { useState, type ReactElement } from 'react'
import type { StartupFailure } from '../../../shared/types/app'
import { Button, ErrorState, Toaster, copyText } from '../../ui'
import { i18n } from '../../i18n'
import styles from './StartupFailureScreen.module.css'

/** The text "Copy details" puts on the clipboard: what failed and where, for a bug report or a support message. */
export function startupFailureDetails(failure: StartupFailure, version: string): string {
  return [`OXESpace ${version}`, `Startup failure: ${failure.code}`, `Database: ${failure.databasePath}`, `Backups: ${failure.backupsPath}`, '', failure.message].join('\n')
}

/**
 * T87: the database could not be opened. This is the whole window: the reason in words, the error's own text folded
 * under Details, and the only things that make sense now. The normal interface never mounts behind it, so no screen
 * pretends to be empty and no button calls a handler that is not there. The window is frameless, so a strip at the
 * top keeps it movable. A locked database may free itself, so that case offers to start again.
 */
export function StartupFailureScreen({ failure }: { failure: StartupFailure }): ReactElement {
  const t = i18n.t.bind(i18n)
  const [opening, setOpening] = useState(false)
  const app = window.oxe?.app
  const openBackups = (): void => {
    setOpening(true)
    void (app?.openBackupsFolder?.() ?? Promise.resolve()).catch(() => undefined).finally(() => setOpening(false))
  }
  return <main className={styles.screen} data-testid="startup-failure" data-code={failure.code}>
    <div className={styles.drag} aria-hidden="true" />
    <h1 className={styles.visuallyHidden}>OXESpace</h1>
    <ErrorState brand heading={2} title={t(`common:startupFailure.${failure.code}.title`)}
      message={t(`common:startupFailure.${failure.code}.message`)} detail={failure.message}
      actions={<>
        {failure.code === 'locked'
          ? <Button variant="primary" onClick={() => { void app?.relaunchAfterStartupFailure?.() }}>{t('common:startupFailure.tryAgain')}</Button>
          : <Button variant="primary" loading={opening} onClick={openBackups}>{t('common:startupFailure.openBackups')}</Button>}
        {failure.code === 'locked' && <Button loading={opening} onClick={openBackups}>{t('common:startupFailure.openBackups')}</Button>}
        <Button onClick={() => { void copyText(startupFailureDetails(failure, app?.version ?? ''), t('common:startupFailure.detailsWhat')) }}>{t('common:startupFailure.copyDetails')}</Button>
        <Button variant="ghost" onClick={() => { void app?.quitAfterStartupFailure?.() }}>{t('common:startupFailure.quit')}</Button>
      </>}>
      <p className={styles.where}>{t('common:startupFailure.backupsAt')} <code>{failure.backupsPath}</code></p>
    </ErrorState>
    <Toaster />
  </main>
}
