import { cpSync } from 'node:fs'
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
            "frame-src http://localhost:* https://localhost:*",
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
