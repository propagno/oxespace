import type renderer from './locales/en'
import type main from '../../shared/locales/en/main.json'
import type oxequery from '../../shared/locales/en/oxequery.json'
import type pods from '../../shared/locales/en/pods.json'
import type post from '../../shared/locales/en/post.json'

// Keys are checked against the English catalogs, the source of truth: t('nav.settings') compiles, a typo does not.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof renderer & { main: typeof main; oxequery: typeof oxequery; pods: typeof pods; post: typeof post }
  }
}
