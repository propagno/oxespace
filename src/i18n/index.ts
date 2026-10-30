import { use } from 'react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LANGUAGES, languageFor, type Language, type LanguagePreference } from '../../shared/i18n'
import { useSettingsStore } from '../store/settings.store'

/**
 * The interface language. The operating system picks it (Portuguese → pt-BR,
 * anything else → English) unless the person chose one in Settings ›
 * Appearance › Language. Each language's catalogs load as their own chunk, so
 * the boot bundle carries only the translator.
 */
export const i18n = i18next

type Bundle = Record<string, Record<string, unknown>>
const BUNDLES: Record<Language, () => Promise<{ default: Bundle }>> = {
  en: () => import('./locales/en'),
  'pt-BR': () => import('./locales/pt-BR')
}

/** Namespaces of lazy views: their catalogs load with the view, never at boot. */
export type LazyNamespace = 'oxequery' | 'pods' | 'post'
type Catalog = { default: Record<string, unknown> }
const LAZY: Record<LazyNamespace, Record<Language, () => Promise<Catalog>>> = {
  oxequery: { en: () => import('../../shared/locales/en/oxequery.json'), 'pt-BR': () => import('../../shared/locales/pt-BR/oxequery.json') },
  pods: { en: () => import('../../shared/locales/en/pods.json'), 'pt-BR': () => import('../../shared/locales/pt-BR/pods.json') },
  post: { en: () => import('../../shared/locales/en/post.json'), 'pt-BR': () => import('../../shared/locales/pt-BR/post.json') }
}
const lazyLoaded = new Set<LazyNamespace>()

async function addLazy(namespace: LazyNamespace, language: Language): Promise<void> {
  if (i18n.hasResourceBundle(language, namespace)) return
  i18n.addResourceBundle(language, namespace, (await LAZY[namespace][language]()).default, true, true)
}

/** Loads a lazy view's catalog in the language on screen (and English, the fallback) before the view renders. */
export async function loadNamespace(namespace: LazyNamespace): Promise<void> {
  lazyLoaded.add(namespace)
  const language = currentLanguage()
  await Promise.all([addLazy(namespace, language), ...(language === 'en' ? [] : [addLazy(namespace, 'en')])])
}

/** A promise React's `use` reads synchronously: it is already settled, so the render never suspends for it. */
const settled = (): Promise<void> => Object.assign(Promise.resolve(), { status: 'fulfilled', value: undefined })
const pending = new Map<string, Promise<void>>()

/**
 * Makes the first render of a lazy view wait, in the nearest Suspense, for its catalog in the language on screen.
 * `use` runs on every render, never behind a condition: React replays a component that suspended, and if the replay
 * skips the `use` the attempt called (the catalog arrived meanwhile), the hooks after it no longer line up and React
 * throws (#467, reported as #520 after it recovers).
 */
export function useNamespace(namespace: LazyNamespace): void {
  const key = `${currentLanguage()}:${namespace}`
  let promise = pending.get(key)
  if (!promise) {
    promise = i18n.hasResourceBundle(currentLanguage(), namespace) ? settled() : loadNamespace(namespace)
    pending.set(key, promise)
  }
  use(promise)
}

/** The operating system's locale as the main process sees it (app.getLocale()). */
export function systemLocale(): string {
  return (typeof window !== 'undefined' && window.oxe?.app?.locale) || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en'
}

/** The language on screen; English until the translator starts. */
export function currentLanguage(): Language {
  return i18n.language === 'pt-BR' ? 'pt-BR' : 'en'
}

async function load(language: Language): Promise<Bundle> {
  return (await BUNDLES[language]()).default
}

function addBundle(language: Language, bundle: Bundle): void {
  for (const [namespace, resources] of Object.entries(bundle)) i18n.addResourceBundle(language, namespace, resources, true, true)
}

function applyLanguage(language: Language): void {
  if (typeof document === 'undefined') return
  document.documentElement.lang = language
  void window.oxe?.app?.setLanguage?.(language)?.catch(() => {})
}

let started: Promise<void> | null = null

/** Starts the translator before the first render, in the saved or the system language. */
export function initI18n(preference: LanguagePreference = useSettingsStore.getState().language): Promise<void> {
  started ??= (async () => {
    const language = languageFor(preference, systemLocale())
    const bundle = await load(language).catch(() => null)
    await i18n.use(initReactI18next).init({
      lng: bundle ? language : 'en',
      fallbackLng: 'en',
      supportedLngs: [...LANGUAGES],
      ns: ['common', 'code', 'thread', 'oxequery', 'pods', 'post', 'settings', 'main'],
      defaultNS: 'common',
      resources: bundle ? { [language]: bundle } : {},
      partialBundledLanguages: true,
      interpolation: { escapeValue: false },
      returnEmptyString: false
    })
    if (!bundle) addBundle('en', await load('en'))
    // English is the fallback for a key a translation lacks; tests/i18n-catalog.test.ts keeps that from happening.
    else if (language !== 'en') void load('en').then(english => addBundle('en', english)).catch(() => {})
    applyLanguage(currentLanguage())
    i18n.on('languageChanged', () => applyLanguage(currentLanguage()))
    useSettingsStore.subscribe((state, previous) => { if (state.language !== previous.language) void changeLanguage(state.language) })
  })()
  return started
}

/** Switches the interface language, loading its catalogs first so nothing flashes untranslated. */
export async function changeLanguage(preference: LanguagePreference): Promise<void> {
  const language = languageFor(preference, systemLocale())
  if (!i18n.hasResourceBundle(language, 'common')) addBundle(language, await load(language))
  await Promise.all([...lazyLoaded].map(namespace => addLazy(namespace, language)))
  await i18n.changeLanguage(language)
}
