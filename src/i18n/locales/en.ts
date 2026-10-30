// The renderer's catalogs for one language, loaded as one chunk (src/i18n/index.ts). The main namespace stays in the main process; OxeQuery's loads with its view (loadNamespace).
import code from '../../../shared/locales/en/code.json'
import common from '../../../shared/locales/en/common.json'
import settings from '../../../shared/locales/en/settings.json'
import thread from '../../../shared/locales/en/thread.json'

export default { common, code, thread, settings }
