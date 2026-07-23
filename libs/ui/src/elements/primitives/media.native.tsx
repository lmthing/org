import * as React from 'react'
import { WebView } from 'react-native-webview'
import { NativeView } from './_native'

/**
 * Media primitives (native fork): `IFrame` → `react-native-webview` `WebView` (this is the
 * app-preview `WebFrame` on native), `Audio`/`Video` → placeholder containers (RN media is a
 * follow-up). Same symbols + prop shapes as `media.tsx` (web). Metro prefers this `.native.tsx`.
 * (Typechecked in the mobile app, which provides react-native-webview types.)
 * See docs/react-native-tamagui-migration.md §1.5 / §7.
 */
export type AudioProps = React.AudioHTMLAttributes<HTMLAudioElement>
export const Audio = React.forwardRef<any, AudioProps>(({ style }, ref) => (
  <NativeView ref={ref} style={style as never} />
))
Audio.displayName = 'Audio'

export type VideoProps = React.VideoHTMLAttributes<HTMLVideoElement>
export const Video = React.forwardRef<any, VideoProps>(({ style }, ref) => (
  <NativeView ref={ref} style={style as never} />
))
Video.displayName = 'Video'

export type IFrameProps = React.IframeHTMLAttributes<HTMLIFrameElement>
export const IFrame = React.forwardRef<any, IFrameProps>(({ src, style }, ref) => (
  <WebView ref={ref as never} source={src ? { uri: String(src) } : undefined} style={style as never} />
))
IFrame.displayName = 'IFrame'
