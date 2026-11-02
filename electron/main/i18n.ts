import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import i18next, { type ParseKeys } from 'i18next'
import { LANGUAGES, languageFor, resolveLanguage, type Language } from '../../shared/i18n'

/**
 * The main process's own translator, for native dialogs and notifications.
 * It reads the `main` namespace of the same catalogs the renderer uses; the
 * renderer reports the person's choice through `app:set-language`. The build
 * copies the catalogs next to the bundle (out/main/locales); from source they
 * are read where they live.
 */
const i18n = i18next.createInstance()
let ready = false

/** The operating system's locale. OXESPACE_LOCALE overrides it so tests do not depend on the machine. */
export function systemLocale(): string {
  return process.env.OXESPACE_LOCALE || (app.isReady() ? app.getLocale() : '') || 'en'
}

const here = dirname(fileURLToPath(import.meta.url))

function catalog(language: Language): Record<string, unknown> {
  for (const root of [join(here, 'locales'), join(here, '..', '..', 'shared', 'locales')]) {
    try { return JSON.parse(readFileSync(join(root, language, 'main.json'), 'utf8')) as Record<string, unknown> } catch { /* try the next place */ }
  }
  return {}
}

function instance(): typeof i18n {
  if (!ready) {
    ready = true
    void i18n.init({
      lng: resolveLanguage(systemLocale()),
      fallbackLng: 'en',
      ns: ['main'],
      defaultNS: 'main',
      resources: Object.fromEntries(LANGUAGES.map(language => [language, { main: catalog(language) }])),
      initAsync: false,
      interpolation: { escapeValue: false }
    })
  }
  return i18n
}

/** Translates a key of the `main` namespace in the interface's current language. */
export function tMain(key: ParseKeys<'main'>, values?: Record<string, unknown>): string {
  return (instance().t as unknown as (key: string, options: object) => string)(key, { ns: 'main', ...values })
}

/** The language native dialogs speak now, for list formatting of C3 parameters. */
export function mainLanguage(): string {
  return instance().language || 'en'
}

/** Follows the renderer: any value but a known language falls back to the operating system's. */
export function setMainLanguage(value: unknown): Language {
  const language = value === 'en' || value === 'pt-BR' ? value : languageFor('system', systemLocale())
  void instance().changeLanguage(language)
  return language
}
