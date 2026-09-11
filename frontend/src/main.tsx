import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerServiceWorker } from './features/offline'
import './styles.css'
import './mobile.css'
import './polish.css'
import './mobile-experience.css'
import './desktop-experience.css'
import './components/player-themes/mobile-player-artwork.css'
import './components/player-themes/player-craft.css'
import './components/player-themes/vinyl-collection.css'
import './desktop-player-polish.css'

void registerServiceWorker().catch(() => undefined)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
