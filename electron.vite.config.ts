import { cpSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Folder under resources/whisper holding this host's whisper.cpp build. The
 * directories are named the electron-builder way (win-x64), not the Node way
 * (win32-x64) — voice.service.ts resolves the same name.
 */
function whisperDirName(): string {
  const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : process.platform
  return `${os}-${process.arch}`
}

/** node_modules path fragments belonging to the react-markdown pipeline (#10). */
const TRANS_CHUNK_PARTS = [
  'react-i18next/dist/es/Trans.js',
  'react-i18next/dist/es/TransWithoutContext.js',
  'html-parse-stringify',
  'void-elements'
]
const MARKDOWN_CHUNK_PARTS = [
  'react-markdown',
  'remark-',
  'micromark',
  'mdast-util',
  'hast-util',
  'unist-util',
  'unified',
  'vfile',
  'property-information',
  'character-entities',
  'decode-named-character-reference',
  'space-separated-tokens',
  'comma-separated-tokens',
  'html-url-attributes',
  'markdown-table',
  'longest-streak',
  'stringify-entities',
  'trim-lines',
  'style-to-js',
  'style-to-object',
  'inline-style-parser',
  'zwitch',
  'devlop',
  'ccount',
  'trough',
  'bail'
]

export default defineConfig({
  main: {
    plugins: [
      // The database drivers are bundled into the OxeQuery worker, not shipped as node_modules.
      externalizeDepsPlugin({ exclude: ['pg', 'pg-cursor', 'mongodb', 'bson'] }),
      {
        name: 'copy-db-migrations',
        closeBundle() {
          cpSync(
            resolve(__dirname, 'electron/main/db/migrations'),
            resolve(__dirname, 'out/main/migrations'),
            { recursive: true }
          )
        }
      },
      {
        // The main process reads its translations (native dialogs, notifications) from files next to the bundle,
        // so new strings never grow the main entry. electron/main/i18n.ts falls back to shared/locales in tests.
        name: 'copy-main-locales',
        closeBundle() {
          for (const language of readdirSync(resolve(__dirname, 'shared/locales'))) {
            cpSync(resolve(__dirname, 'shared/locales', language, 'main.json'), resolve(__dirname, 'out/main/locales', language, 'main.json'))
          }
        }
      },
      {
        // Mirror resources/mcp-bridge into out/main/mcp-bridge so the
        // bootstrap (`__dirname/mcp-bridge/oxespace-mcp.js`) finds the
        // bridge script in dev. The packaged build picks it up via the
        // electron-builder extraResources entry, not this plugin.
        name: 'copy-mcp-bridge',
        closeBundle() {
          cpSync(
            resolve(__dirname, 'resources/mcp-bridge'),
            resolve(__dirname, 'out/main/mcp-bridge'),
            { recursive: true }
          )
        }
      },
      {
        // Mirror the bundled whisper.cpp binary into out/main/whisper so the
        // voice service (`__dirname/whisper/whisper-cli.exe`) resolves it in
        // dev. The packaged build picks it up via the electron-builder
        // extraResources entry. No-op until the binary is present — only a
        // win-x64 build is bundled today, so on other hosts the voice service
        // reports the engine unavailable and the feature hides itself.
        name: 'copy-whisper',
        closeBundle() {
          const src = resolve(__dirname, `resources/whisper/${whisperDirName()}`)
          if (existsSync(src)) {
            cpSync(src, resolve(__dirname, 'out/main/whisper'), { recursive: true })
          }
        }
      },
      {
        name: 'copy-codegraph-assets',
        closeBundle() {
          const schemaSrc = resolve(__dirname, 'electron/main/vendor/codegraph/db/schema.sql')
          if (existsSync(schemaSrc)) {
            cpSync(schemaSrc, resolve(__dirname, 'out/main/schema.sql'))
          }
          const wasmSrc = resolve(__dirname, 'electron/main/vendor/codegraph/extraction/wasm')
          if (existsSync(wasmSrc)) {
            cpSync(wasmSrc, resolve(__dirname, 'out/main/wasm'), { recursive: true })
          }
          const tsWasmsSrc = resolve(__dirname, 'node_modules/tree-sitter-wasms/out')
          if (existsSync(tsWasmsSrc)) {
            cpSync(tsWasmsSrc, resolve(__dirname, 'out/main/wasm'), { recursive: true })
          }
          // web-tree-sitter's core runtime wasm — Parser.init()'s locateFile()
          // resolves it from out/main (assetDir). The filename differs by major:
          // 0.25.x ships `tree-sitter.wasm`, 0.26.x ships `web-tree-sitter.wasm`.
          // Copy whichever exists so the worker can load the runtime; without it
          // grammar loading fails and CodeGraph indexes nothing.
          for (const name of ['tree-sitter.wasm', 'web-tree-sitter.wasm']) {
            const coreWasm = resolve(__dirname, 'node_modules/web-tree-sitter', name)
            if (existsSync(coreWasm)) cpSync(coreWasm, resolve(__dirname, 'out/main', name))
          }
        }
      }
    ],
    resolve: {
      // pg requires pg-cloudflare only on Cloudflare Workers; the bundle made it a static import of a
      // package the installer does not ship (OxeQuery could not connect on installed 1.0.0 builds).
      alias: { 'pg-cloudflare': resolve(__dirname, 'electron/main/workers/pg-cloudflare-stub.ts') }
    },
    build: {
      rollupOptions: {
        // Optional driver add-ons are never installed; leave them as runtime requires.
        // ssh2 tries optional native add-ons (cpu-features, its crypto binding) and falls back to pure JS.
        external: ['better-sqlite3', 'node-pty', 'pg-native', '@aws-sdk/credential-providers', '@mongodb-js/zstd', 'gcp-metadata', 'kerberos', 'mongodb-client-encryption', 'snappy', 'socks', 'cpu-features', /\.node(\?.*)?$/],
        output: {
          // Keep optional documentation descriptors outside the main entry.
          // A few bytes of platform-dependent output must not decide release
          // success; runtime and handlers remain dynamically loaded as before.
          manualChunks(id) {
            if (id.replaceAll('\\', '/').endsWith('/mcp-internal/documentation-tools.ts')) return 'documentation-tools'
          },
          // The OxeQuery worker bundles CommonJS libraries (ssh2, mongodb) that use
          // `require` and `__dirname`, which do not exist in an ES module chunk.
          banner: (chunk: { name: string }) => chunk.name === 'oxequery-worker'
            ? [
              "import { createRequire as __oxeCreateRequire } from 'node:module';",
              "import { fileURLToPath as __oxeFileURLToPath } from 'node:url';",
              "import { dirname as __oxeDirname } from 'node:path';",
              'const require = __oxeCreateRequire(import.meta.url);',
              'const __filename = __oxeFileURLToPath(import.meta.url);',
              'const __dirname = __oxeDirname(__filename);'
            ].join('\n')
            : ''
        },
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          'semantic-worker': resolve(__dirname, 'electron/main/workers/semantic-worker.ts'),
          'native-history-worker': resolve(__dirname, 'electron/main/workers/native-history-worker.ts'),
          'oxequery-worker': resolve(__dirname, 'electron/main/workers/oxequery-worker.ts'),
          // CodeGraph parsing worker — keeps tree-sitter parsing off the main
          // thread so it doesn't block (and time out) semantic embedding on the
          // initial index. extraction/index.ts loads it from out/main/parse-worker.js.
          'parse-worker': resolve(__dirname, 'electron/main/vendor/codegraph/extraction/parse-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // The bridge is a long table of one-line forwarders; minifying it keeps the 40 kB budget meaningful.
      minify: 'esbuild',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          // Design Mode (#3): injected into the <webview> guest page so element
          // picking runs inside the previewed site, isolated from the renderer.
          'design-guest': resolve(__dirname, 'electron/preload/design-guest.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: '.',
    plugins: [
      react(),
      {
        name: 'inject-prod-csp',
        apply: 'build',
        transformIndexHtml(html) {
          const csp = [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "worker-src 'self' blob:",
            "connect-src 'self'",
            // The Web Preview pane is meant to embed arbitrary URLs (the user's
            // dev server AND external sites opened via oxespace_open_web_preview).
            // Restricting frame-src to localhost blocked external previews in the
            // packaged build. http:/https: scoping still bars data:/file: frames.
            // blob: is needed by the PDF preview (#10), which hands Chromium's
            // built-in viewer a same-origin object URL built in the renderer.
            "frame-src http: https: blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'none'"
          ].join('; ')
          return html.replace(
            '<meta charset="UTF-8" />',
            `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`
          )
        }
      }
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@renderer': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared')
      }
    },
    build: {
      // electron-vite leaves the renderer JS readable unless asked: minify it, so the
      // budgets measure what ships. CSS is set on its own rather than tracking `minify`.
      minify: 'esbuild',
      cssMinify: 'esbuild',
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
        output: {
          // Split heavy vendors out of the entry chunk so first paint doesn't
          // parse/execute Monaco, xterm, etc. Combined with the React.lazy panel
          // splits, this shrinks the initial bundle (was a ~9MB monolith).
          manualChunks(id: string) {
            // Vite's preload helper is shared by every lazy import. Left alone it lands in
            // the first chunk that uses it (monaco), and the entry then preloads all of
            // Monaco at boot to reach it.
            if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'vendor'
            if (!id.includes('node_modules')) return undefined
            if (id.includes('monaco-editor')) return 'monaco'
            if (id.includes('@xterm')) return 'xterm'
            // Brand marks for the MCP catalog, which loads on demand; the boot path must not carry them.
            if (id.includes('simple-icons')) return 'brand-icons'
            if (id.includes('@xenova') || id.includes('onnxruntime')) return 'ml'
            // The YAML parser is reached only by the OxePost OpenAPI import, which loads on demand.
            if (id.includes('js-yaml')) return 'yaml'
            // The markdown pipeline (#10) is only reached through the lazy
            // MarkdownPreview, so keep it out of the eagerly-loaded vendor chunk.
            if (MARKDOWN_CHUNK_PARTS.some((part) => id.includes(part))) return 'markdown'
            // <Trans> (rich text inside a translation) is only used by lazy views such as OxeQuery;
            // boot needs useTranslation alone, so the parser behind <Trans> stays out of vendor.
            if (TRANS_CHUNK_PARTS.some((part) => id.includes(part))) return 'i18n-trans'
            // React + everything that consumes it (radix-ui, cmdk, xyflow,
            // @monaco-editor/react, lucide, …) MUST share one chunk. Splitting
            // React into its own chunk broke cross-chunk eval order once the
            // radix transitive deps (react-remove-scroll, use-sidecar, …) grew
            // → "Cannot read properties of undefined (reading 'useState')" at boot.
            return 'vendor'
          }
        }
      }
    }
  }
})
