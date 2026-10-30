// The renderer's catalogs for one language, loaded as one chunk (src/i18n/index.ts). The main namespace comes along for the
// messages the main process sends as codes (src/i18n/mainMessage.ts); OxeQuery's, OxePod's and OxePost's load with their view (loadNamespace).
import code from '../../../shared/locales/pt-BR/code.json'
import common from '../../../shared/locales/pt-BR/common.json'
import main from '../../../shared/locales/pt-BR/main.json'
import settings from '../../../shared/locales/pt-BR/settings.json'
import thread from '../../../shared/locales/pt-BR/thread.json'

export default { common, code, thread, settings, main }
