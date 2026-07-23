import * as React from 'react'
import { UnavailableOnMobile } from '../elements/content/unavailable-on-mobile/index'
import type { IdeEditorProps } from './ide-editor.web'

/**
 * Native fallback for the Monaco code editor (web-only widget, §1.6). Imports NO Monaco —
 * Metro never sees @monaco-editor/react through this file, so it can't break/bloat the native
 * bundle. On web this file is never bundled; the `.web.tsx` implementation is used instead.
 */
export function IdeEditor(_props: IdeEditorProps) {
  return <UnavailableOnMobile feature="Code editor" />
}

export type { IdeEditorProps }
