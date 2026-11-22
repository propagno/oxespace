import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, SettingRow, SettingsSection, toast } from '../../ui'
import { clearSeenHosts, SEEN_HOSTS_EVENT, seenHosts } from '../../lib/externalLinks'

/** Settings › General › Privacy: forget the sites links were opened to, so each one asks again. */
export function SeenSitesSetting(): ReactElement {
  const { t } = useTranslation('settings')
  const [count, setCount] = useState(() => seenHosts().length)
  useEffect(() => {
    const update = (): void => setCount(seenHosts().length)
    window.addEventListener(SEEN_HOSTS_EVENT, update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener(SEEN_HOSTS_EVENT, update); window.removeEventListener('storage', update) }
  }, [])
  return <SettingsSection title={t('general.privacy')}>
    <SettingRow testId="seen-sites-setting" label={t('general.seenSites.label')}
      description={<>{t('general.seenSites.hint')}<br /><span data-testid="seen-sites-count">{t('general.seenSites.count', { count })}</span></>}
      control={<Button disabled={count === 0} aria-label={t('general.seenSites.clearLabel')} onClick={() => {
        const cleared = clearSeenHosts()
        setCount(0)
        toast({ title: t('general.seenSites.cleared', { count: cleared }), intent: 'success', duration: 3000 })
      }}>{t('general.seenSites.clear')}</Button>} />
  </SettingsSection>
}
