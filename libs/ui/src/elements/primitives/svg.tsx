import { svgPrimitive } from './_host'

/**
 * SVG-family passthrough primitives (Phase 0): `<svg>` and its inline children. Named to mirror
 * `react-native-svg`'s component names (`Svg`, `Path`, `Rect`, `Circle`, `G`, …) so Phase 1
 * swaps each web host tag for the identically-named RN-svg component with NO surface edits —
 * inline icons then render on native too. Pure `forwardRef` passthroughs on web.
 *
 * See docs/react-native-tamagui-migration.md §1.5 / §4 (Icon row).
 */
export const Svg = svgPrimitive<SVGSVGElement>('svg', 'Svg')
export const Path = svgPrimitive<SVGPathElement>('path', 'Path')
export const Rect = svgPrimitive<SVGRectElement>('rect', 'Rect')
export const Circle = svgPrimitive<SVGCircleElement>('circle', 'Circle')
export const Ellipse = svgPrimitive<SVGEllipseElement>('ellipse', 'Ellipse')
export const Line = svgPrimitive<SVGLineElement>('line', 'Line')
export const Polyline = svgPrimitive<SVGPolylineElement>('polyline', 'Polyline')
export const Polygon = svgPrimitive<SVGPolygonElement>('polygon', 'Polygon')
export const G = svgPrimitive<SVGGElement>('g', 'G')
export const Defs = svgPrimitive<SVGDefsElement>('defs', 'Defs')
export const LinearGradient = svgPrimitive<SVGLinearGradientElement>('linearGradient', 'LinearGradient')
export const RadialGradient = svgPrimitive<SVGRadialGradientElement>('radialGradient', 'RadialGradient')
export const Stop = svgPrimitive<SVGStopElement>('stop', 'Stop')
export const SvgText = svgPrimitive<SVGTextElement>('text', 'SvgText')
export const Tspan = svgPrimitive<SVGTSpanElement>('tspan', 'Tspan')
export const Use = svgPrimitive<SVGUseElement>('use', 'Use')
export const ClipPath = svgPrimitive<SVGClipPathElement>('clipPath', 'ClipPath')
export const Mask = svgPrimitive<SVGMaskElement>('mask', 'Mask')
