import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './library.css'
import { LibraryApp } from './components/LibraryApp'

createRoot(document.getElementById('library-root')!).render(
  <StrictMode>
    <LibraryApp />
  </StrictMode>,
)
