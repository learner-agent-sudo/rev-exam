import '@fontsource-variable/fraunces/wght.css'
import '@fontsource-variable/literata/wght.css'
import '@fontsource-variable/ibm-plex-sans/wght.css'
import './styles/theme.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
