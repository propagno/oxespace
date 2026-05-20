import React from 'react'
import ReactDOM from 'react-dom/client'
// Inter Variable is the project's UI font (matches Codex Desktop baseline).
// Bundled via @fontsource-variable/inter so it loads offline without CDNs.
import '@fontsource-variable/inter'
import { App } from './App'
import './styles.css'
import '@xyflow/react/dist/style.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
