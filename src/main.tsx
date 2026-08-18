import React from 'react'
import ReactDOM from 'react-dom/client'
// Inter Variable is the project's UI font (matches Codex Desktop baseline).
// Bundled via @fontsource-variable/inter so it loads offline without CDNs.
import '@fontsource-variable/inter'
import { App } from './App'
// F1: shadcn/Tailwind foundation must load BEFORE styles.css so OXESpace tokens
// win the names both systems share (see ui-kit.css coexistence contract).
import './styles/ui-kit.css'
import './styles.css'
import '@xyflow/react/dist/style.css'

// OXESpace is a dark-first UI; shadcn primitives read the `.dark` token set.
document.documentElement.classList.add('dark')

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
