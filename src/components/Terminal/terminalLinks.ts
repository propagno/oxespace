import { WebLinksAddon } from '@xterm/addon-web-links'
import { i18n } from '../../i18n'
import { openExternalLink } from '../../lib/externalLinks'

const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/** Ctrl+click (Cmd+click on macOS) opens a link; a plain click keeps selecting text. */
export function onTerminalLink(event: MouseEvent, uri: string): void {
  if (event.ctrlKey || event.metaKey) void openExternalLink(uri, { text: uri, source: 'terminal' })
}

/**
 * Terminal links go through the same confirmed path as every other link. xterm's default handler opened a blank
 * window and set its address afterwards, which the main process refuses, so terminal links opened nothing.
 * Hovering a link says which key opens it.
 */
export function createTerminalLinksAddon(): WebLinksAddon {
  return new WebLinksAddon(onTerminalLink, {
    hover: event => {
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target) target.title = i18n.t('links.terminalHint', { ns: 'common', key: isMac() ? 'Cmd' : 'Ctrl' })
    },
    leave: event => { if (event.target instanceof HTMLElement) event.target.removeAttribute('title') }
  })
}
