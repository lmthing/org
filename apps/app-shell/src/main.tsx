/**
 * AppHost's entry. Mounts {@link AppHost} into `#root`.
 *
 * `AppHost` itself wraps the renderer in `ViewThemeProvider`, so the theme context (`Prim.*`
 * requires it) is mounted regardless of which page is on screen — including the loading and
 * error states, which appear BEFORE a spec is matched and therefore OUTSIDE the renderer's
 * own tree. The stylesheet (`./styles.css`) pulls in the shared `theme.css` so the
 * `--lm-*` tokens those primitives read actually resolve.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './styles.css'
import { AppHost } from './app-host'

const el = document.getElementById('root')
if (!el) throw new Error('[app-shell] mount target #root not found')

createRoot(el).render(
  <StrictMode>
    <AppHost />
  </StrictMode>,
)
