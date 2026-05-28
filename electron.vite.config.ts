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
      }
    ],
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'node-pty'],
        input: {
          index: resolve(__dirname, 'electron/main/index.ts')
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
        input: resolve(__dirname, 'index.html')
      }
    }
  }
})
