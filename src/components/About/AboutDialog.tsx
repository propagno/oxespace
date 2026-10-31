import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Bug, Copy, ExternalLink } from 'lucide-react'
import type { AppAbout } from '../../../shared/types/app'
import { OxeMark } from '../Brand/OxeLogo'
import { OPEN_REPORT_PROBLEM_EVENT } from '../Diagnostics/ReportProblemHost'
import { Badge, Button, copyText, Dialog, Notice, Skeleton } from '../../ui'
import { formatDateTime } from '../../utils/formatTime'
import { openExternalLink } from '../../lib/externalLinks'
import styles from './AboutDialog.module.css'

const PLATFORMS: Record<string, string> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' }

/** Where the source, the release notes and the licenses of this build live: the tag for a release, main for a dev run. */
export function aboutLinks(about: Pick<AppAbout, 'version' | 'channel' | 'repositoryUrl'>): { repository: string; releaseNotes: string; license: string; notices: string } {
  const ref = about.channel === 'dev' ? 'main' : `v${about.version}`
  return {
    repository: about.repositoryUrl,
    releaseNotes: about.channel === 'dev' ? `${about.repositoryUrl}/releases` : `${about.repositoryUrl}/releases/tag/v${about.version}`,
    license: `${about.repositoryUrl}/blob/${ref}/LICENSE`,
    notices: `${about.repositoryUrl}/blob/${ref}/THIRD_PARTY_NOTICES.md`
  }
}

/** The build facts as plain text, for a problem report or a support message. */
export function aboutText(about: AppAbout): string {
  return [
    `OXESpace ${about.version} (${about.channel})`,
    about.commit && `Commit: ${about.commit}`,
    about.builtAt && `Built: ${about.builtAt}`,
    `Electron ${about.versions.electron} · Chromium ${about.versions.chrome} · Node.js ${about.versions.node} · V8 ${about.versions.v8}`,
    `${PLATFORMS[about.platform] ?? about.platform} ${about.osRelease} (${about.arch})`
  ].filter(Boolean).join('\n')
}

const open = (url: string): void => { void openExternalLink(url, { source: 'app' }) }

/** About OXESpace: the version and channel, what the build is made of, the license and where to read more. */
export function AboutDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation()
  const [about, setAbout] = useState<AppAbout | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let alive = true
    const read = window.oxe?.app?.about
    if (!read) { setUnavailable(true); return }
    read().then(value => { if (alive) setAbout(value) }, () => { if (alive) setUnavailable(true) })
    return () => { alive = false }
  }, [])

  const version = about?.version ?? window.oxe?.app?.version ?? 'dev'
  const links = aboutLinks({ version, channel: about?.channel ?? 'dev', repositoryUrl: about?.repositoryUrl ?? 'https://github.com/propagno/oxespace' })
  const rows: Array<[string, string]> = about ? [
    ...(about.commit ? [[t('about.commit'), about.commit] as [string, string]] : []),
    ...(about.builtAt ? [[t('about.built'), formatDateTime(Date.parse(about.builtAt))] as [string, string]] : []),
    ['Electron', about.versions.electron], ['Chromium', about.versions.chrome], ['Node.js', about.versions.node], ['V8', about.versions.v8],
    [t('about.system'), `${PLATFORMS[about.platform] ?? about.platform} ${about.osRelease} · ${about.arch}`]
  ] : []

  return <Dialog title={t('about.title')} onClose={onClose} testId="about-dialog"
    footer={<>
      <Button data-align="start" icon={<Bug size={14} aria-hidden="true" />} onClick={() => { onClose(); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(OPEN_REPORT_PROBLEM_EVENT))) }}>{t('about.report')}</Button>
      {about && <Button icon={<Copy size={14} aria-hidden="true" />} onClick={() => void copyText(aboutText(about), t('about.details'))}>{t('about.copy')}</Button>}
      <Button variant="primary" onClick={onClose}>{t('ui.close')}</Button>
    </>}>
    <div className={styles.identity}>
      <OxeMark size={56} tile />
      <div>
        <p className={styles.name}>OXESpace</p>
        <p className={styles.version}>{t('about.versionLine', { version })} {about && <Badge intent={about.channel === 'stable' ? 'success' : about.channel === 'beta' ? 'warning' : 'neutral'}>{t(`about.channel.${about.channel}`)}</Badge>}</p>
        <p className={styles.tagline}>{t('about.tagline')}</p>
      </div>
    </div>
    {!about && !unavailable && <Skeleton lines={4} label={t('about.loading')} />}
    {unavailable && <Notice intent="info">{t('about.unavailable')}</Notice>}
    {rows.length > 0 && <dl className={styles.facts}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    <p className={styles.license}>{t('about.license')}</p>
    <ul className={styles.links} aria-label={t('about.links')}>
      {([['repository', links.repository], ['releaseNotes', links.releaseNotes], ['licenseText', links.license], ['notices', links.notices]] as const).map(([key, url]) =>
        <li key={key}><Button variant="link" onClick={() => open(url)}>{t(`about.link.${key}`)}<ExternalLink size={12} aria-hidden="true" /></Button></li>)}
    </ul>
  </Dialog>
}
