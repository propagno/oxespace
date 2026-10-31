import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, toast } from '../../ui'
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
  return <>
    <h3>{t('general.privacy')}</h3>
    <div className="settings-general-card" data-testid="seen-sites-setting"><div>
      <label htmlFor="clear-seen-sites">{t('general.seenSites.label')}</label>
      <p>{t('general.seenSites.hint')}</p>
      <p data-testid="seen-sites-count">{t('general.seenSites.count', { count })}</p></div>
      <Button id="clear-seen-sites" disabled={count === 0} onClick={() => {
        const cleared = clearSeenHosts()
        setCount(0)
        toast({ title: t('general.seenSites.cleared', { count: cleared }), intent: 'success', duration: 3000 })
      }}>{t('general.seenSites.clear')}</Button>
    </div>
  </>
}
