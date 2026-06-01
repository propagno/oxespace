import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

/**
 * Self-host Monaco. By default `@monaco-editor/react` loads the editor AMD
 * bundle from `cdn.jsdelivr.net`, which (a) corporate proxies/VPNs block (the
 * Editor then never opens behind e.g. an enterprise VPN) and (b) the packaged
 * build's CSP forbids anyway (`script-src 'self'`). Point the loader at the
 * bundled npm `monaco-editor` and register its language workers locally so the
 * Editor is fully offline and CSP-compliant (`worker-src 'self' blob:`).
 *
 * Imported for its side effects from EditorPane, before the <Editor> mounts.
 */
const monacoEnvironment: monaco.Environment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      default:
        return new EditorWorker()
    }
  }
}

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = monacoEnvironment

// Use the bundled instance instead of fetching from the CDN.
loader.config({ monaco })
