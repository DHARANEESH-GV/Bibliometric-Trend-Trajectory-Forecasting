import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter-tight/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/fraunces/400.css'
import '@fontsource/fraunces/600.css'
import '@fontsource/fraunces/700.css'
import '@fontsource/fraunces/400-italic.css'
import '@fontsource/newsreader/400.css'
import '@fontsource/newsreader/400-italic.css'
import './styles/tokens.css'
import './styles/base.css'
import './views/leaderboard.css'
import './views/matrix.css'
import { App } from './App'

const router = createBrowserRouter([
  {
    path: '/*',
    element: <App />,
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
