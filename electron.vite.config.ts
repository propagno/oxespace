import { cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin(),
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
        // extraResources entry. No-op until the binary is present.
        name: 'copy-whisper',
        closeBundle() {
          const src = resolve(__dirname, 'resources/whisper/win-x64')
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
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'node-pty'],
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          'semantic-worker': resolve(__dirname, 'electron/main/workers/semantic-worker.ts'),
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
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts')
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
            "frame-src http: https:",
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
        '@renderer': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared')
      }
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
        output: {
          // Split heavy vendors out of the entry chunk so first paint doesn't
          // parse/execute Monaco, xterm, etc. Combined with the React.lazy panel
          // splits, this shrinks the initial bundle (was a ~9MB monolith).
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined
            if (id.includes('monaco-editor')) return 'monaco'
            if (id.includes('@xterm')) return 'xterm'
            if (id.includes('react-dom') || id.includes('/scheduler/') || /[\\/]react[\\/]/.test(id)) return 'react-vendor'
            if (id.includes('lucide-react')) return 'icons'
            if (id.includes('@xenova') || id.includes('onnxruntime')) return 'ml'
            return 'vendor'
          }
        }
      }
    }
  }
})
