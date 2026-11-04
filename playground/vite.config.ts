import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Fixed ports so the playground never clashes with the app's dev server.
export default defineConfig({
  plugins: [react()],
  server: { port: 5199, strictPort: true },
  preview: { port: 5198, strictPort: true }
})
