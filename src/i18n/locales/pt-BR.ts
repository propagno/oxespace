// The renderer's catalogs for one language, loaded as one chunk (src/i18n/index.ts). The main namespace stays in the main process, except its message codes (shared/messages.ts), which the window words (src/i18n/mainMessage.ts); OxeQuery's, OxePod's and OxePost's load with their view (loadNamespace).
import code from '../../../shared/locales/pt-BR/code.json'
import common from '../../../shared/locales/pt-BR/common.json'
import settings from '../../../shared/locales/pt-BR/settings.json'
import thread from '../../../shared/locales/pt-BR/thread.json'
import { messages } from '../../../shared/locales/pt-BR/main.json'

export default { common, code, thread, settings, main: { messages } }
