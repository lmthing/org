import * as React from 'react'
import { UnavailableOnMobile } from '../unavailable-on-mobile/index'
import type { TerminalProps, TerminalSession } from './index.web'

/**
 * Native fallback for the xterm terminal (web-only widget, §1.6). Imports NO @xterm/* — Metro never
 * sees those deps through this file, so they can't break/bloat the native bundle. On web this file
 * is never bundled; the `.web.tsx` xterm implementation is used instead. Mirrors the Monaco
 * `ide-editor.native.tsx` fallback.
 */
function Terminal(_props: TerminalProps) {
  return <UnavailableOnMobile feature="Terminal" />
}

export { Terminal }
export type { TerminalProps, TerminalSession }
