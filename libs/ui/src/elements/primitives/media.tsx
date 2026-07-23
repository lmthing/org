import * as React from 'react'
import { hostPrimitive } from './_host.tsx'

/**
 * Media passthrough primitives (Phase 0): `<audio>`, `<video>`, `<iframe>`. Pure passthroughs.
 * `<iframe>` (the app-preview `WebFrame` seam) becomes `react-native-webview` on native in
 * Phase 1; `<audio>`/`<video>` map to RN media on native (§7).
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §7.
 */
export type AudioProps = React.AudioHTMLAttributes<HTMLAudioElement>
export const Audio = hostPrimitive<HTMLAudioElement, AudioProps>('audio', 'Audio')

export type VideoProps = React.VideoHTMLAttributes<HTMLVideoElement>
export const Video = hostPrimitive<HTMLVideoElement, VideoProps>('video', 'Video')

export type IFrameProps = React.IframeHTMLAttributes<HTMLIFrameElement>
export const IFrame = hostPrimitive<HTMLIFrameElement, IFrameProps>('iframe', 'IFrame')
