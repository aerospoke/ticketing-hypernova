import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Tipografía empaquetada con el portal (no depende de internet ni de Google Fonts).
import '@fontsource-variable/outfit'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
