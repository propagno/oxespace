import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/playground.css'
import './design/mandacaru-1.5.css'
import './styles/atoms.css'
import './styles/b.css'
import { Playground } from './Playground'

createRoot(document.getElementById('root')!).render(<StrictMode><Playground /></StrictMode>)
