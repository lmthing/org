/**
 * `chart` — the one dashboard surface the rest of the vocabulary cannot fake.
 *
 * ## Why this is hand-drawn SVG and not a charting library
 *
 * Every JS charting library is DOM-bound (`recharts`, `chart.js`, `visx` all render to
 * `<svg>`/`<canvas>` through `react-dom`), and the whole point of a spec app is that the
 * SAME renderer draws it on a phone with no WebView. A library import here would mean a
 * dashboard on the web and a hole on native — exactly the divergence the metro graph gate
 * exists to prevent. So the four kinds below are drawn from `Prim.Svg` primitives, which
 * fork to `react-native-svg`.
 *
 * ## The two native traps this file is written around
 *
 *  1. **A `$token` is not a colour to RNSVG.** `elements/primitives/svg.native.tsx` is a bare
 *     re-export of `react-native-svg`, which parses a fill/stroke string as a colour and draws
 *     NOTHING when it cannot (the same fault that silently erased every toned icon — see
 *     `icons.tsx#useColorValue`). Every colour here goes through `useColorValue` first, so what
 *     reaches the SVG is a resolved `rgb()`/hex that is valid on both targets.
 *  2. **Text inside SVG is a different beast per target.** Axis labels are therefore ordinary
 *     `Prim.Text` laid out AROUND the plot, never `SvgText` inside it — one less native-only
 *     failure mode, and it makes the labels selectable and clamp-able like any other text.
 *
 * Geometry is computed in a fixed unitless viewBox and scaled by the SVG itself, so the same
 * numbers describe the plot at any width. Nothing here reads the DOM or measures a layout.
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'
import { useColorValue } from './icons'
import { clampProps } from './clamp'
import type { Tone } from './types'

/** One plotted point. `series` groups points into lines/bands; absent ⇒ a single series. */
export interface ChartDatum {
  x: string
  y: number
  series?: string
}

export interface ChartViewProps {
  kind: 'bar' | 'line' | 'area' | 'donut'
  data: ChartDatum[]
  /** Plot height in px. The width is always the container's. */
  height?: number
  /** The base tone for a single-series plot. Multi-series cycles the palette below. */
  tone?: Exclude<Tone, 'auto'>
  /** Axis / legend caption. */
  label?: string
  /** How a value reads in the legend and the donut centre. */
  formatValue?: (n: number) => string
}

/**
 * The series palette, in the order it is spent.
 *
 * Design tokens, never raw colours — which is also why there are six and not twenty: the
 * design system has six semantic colours, and inventing a seventh for a chart would be the
 * one place in the app where a colour comes from somewhere other than the token file.
 * A seventh series reuses the first, which is honest (and rare enough to be unmeasured).
 */
const SERIES_TOKENS = ['$primary', '$success', '$warning', '$knowledge', '$destructive', '$muted-foreground'] as const

const VIEW_W = 100
const VIEW_H = 60

/** Resolve the palette once per render — hooks may not run in a loop. */
function usePalette(base?: Exclude<Tone, 'auto'>): string[] {
  const primary = useColorValue(base ? TONE_FILL[base] : SERIES_TOKENS[0])
  const c2 = useColorValue(SERIES_TOKENS[1])
  const c3 = useColorValue(SERIES_TOKENS[2])
  const c4 = useColorValue(SERIES_TOKENS[3])
  const c5 = useColorValue(SERIES_TOKENS[4])
  const c6 = useColorValue(SERIES_TOKENS[5])
  return [primary, c2, c3, c4, c5, c6]
}

/** A tone's plotting colour. `neutral` plots as the primary — a grey chart reads as disabled. */
const TONE_FILL: Record<Exclude<Tone, 'auto'>, string> = {
  neutral: '$primary',
  accent: '$primary',
  success: '$success',
  warning: '$warning',
  danger: '$destructive',
  info: '$knowledge',
}

/** Group the data into series, preserving first-seen order for both series and categories. */
function groupSeries(data: ChartDatum[]): { name: string; points: ChartDatum[] }[] {
  const out: { name: string; points: ChartDatum[] }[] = []
  const index = new Map<string, number>()
  for (const d of data) {
    const name = d.series ?? ''
    let at = index.get(name)
    if (at === undefined) {
      at = out.length
      index.set(name, at)
      out.push({ name, points: [] })
    }
    out[at].points.push(d)
  }
  return out
}

/** Every distinct x, in first-seen order — the shared category axis. */
function categories(data: ChartDatum[]): string[] {
  const seen: string[] = []
  for (const d of data) if (!seen.includes(d.x)) seen.push(d.x)
  return seen
}

/**
 * The value axis top.
 *
 * Always includes zero and never returns 0, because a flat all-zero series divided by its own
 * max is `NaN` — which renders as an empty plot that looks exactly like "no data" while the
 * endpoint is in fact answering. A zero series draws as a flat line at the baseline instead.
 */
function axisMax(data: ChartDatum[]): number {
  let max = 0
  for (const d of data) if (Number.isFinite(d.y) && d.y > max) max = d.y
  return max === 0 ? 1 : max
}

export function ChartView({ kind, data, height = 160, tone, label, formatValue }: ChartViewProps): React.ReactElement {
  const palette = usePalette(tone)
  const grid = useColorValue('$border')
  const clean = data.filter((d) => Number.isFinite(d.y))

  if (clean.length === 0) {
    return (
      <Prim.Text fontSize="$xs" color="$muted-foreground">
        No data to plot
      </Prim.Text>
    )
  }

  const series = groupSeries(clean)
  const cats = categories(clean)
  const max = axisMax(clean)
  const fmt = formatValue ?? ((n: number) => String(Math.round(n * 100) / 100))

  return (
    <Prim.Col gap="$2" width="100%">
      {label ? (
        <Prim.Text fontSize="$xs" color="$muted-foreground">
          {label}
        </Prim.Text>
      ) : null}

      <Prim.Box width="100%" height={height}>
        <Prim.Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio={kind === 'donut' ? 'xMidYMid meet' : 'none'}
        >
          {kind === 'donut' ? (
            <DonutSlices series={series} palette={palette} />
          ) : (
            <>
              {/* The baseline. A plot with no axis at all reads as decoration. */}
              <Prim.Line x1={0} y1={VIEW_H} x2={VIEW_W} y2={VIEW_H} stroke={grid} strokeWidth={0.5} />
              {kind === 'bar' ? (
                <Bars series={series} cats={cats} max={max} palette={palette} />
              ) : (
                <Lines series={series} cats={cats} max={max} palette={palette} area={kind === 'area'} />
              )}
            </>
          )}
        </Prim.Svg>
      </Prim.Box>

      {/* Categories under a bar/line plot; a value legend beside a donut. */}
      {kind === 'donut' ? (
        <Prim.Col gap="$1">
          {series.flatMap((s, si) =>
            s.points.map((p, pi) => (
              <Prim.Row key={`${si}-${pi}`} gap="$2" alignItems="center">
                <Prim.Box width={8} height={8} borderRadius="$radius-full" backgroundColor={palette[(si + pi) % palette.length]} />
                <Prim.Text fontSize="$xs" color="$muted-foreground" flexGrow={1} flexShrink={1} flexBasis="0%">
                  {p.x}
                </Prim.Text>
                <Prim.Text fontSize="$xs" color="$foreground">
                  {fmt(p.y)}
                </Prim.Text>
              </Prim.Row>
            )),
          )}
        </Prim.Col>
      ) : (
        <Prim.Row justifyContent="space-between" gap="$1">
          {cats.map((c, i) => (
            <Prim.Text key={i} fontSize="$xs" color="$muted-foreground" {...clampProps(1)}>
              {c}
            </Prim.Text>
          ))}
        </Prim.Row>
      )}

      {series.length > 1 && kind !== 'donut' ? (
        <Prim.Row gap="$3" flexWrap="wrap">
          {series.map((s, i) => (
            <Prim.Row key={i} gap="$1" alignItems="center">
              <Prim.Box width={8} height={8} borderRadius="$radius-full" backgroundColor={palette[i % palette.length]} />
              <Prim.Text fontSize="$xs" color="$muted-foreground">
                {s.name || 'Series'}
              </Prim.Text>
            </Prim.Row>
          ))}
        </Prim.Row>
      ) : null}
    </Prim.Col>
  )
}

function Bars({
  series,
  cats,
  max,
  palette,
}: {
  series: { name: string; points: ChartDatum[] }[]
  cats: string[]
  max: number
  palette: string[]
}): React.ReactElement {
  const slot = VIEW_W / Math.max(1, cats.length)
  const barW = (slot * 0.7) / series.length
  return (
    <>
      {series.map((s, si) =>
        s.points.map((p, pi) => {
          const at = cats.indexOf(p.x)
          if (at < 0) return null
          const h = (Math.max(0, p.y) / max) * (VIEW_H - 2)
          const x = at * slot + slot * 0.15 + si * barW
          return (
            <Prim.Rect
              key={`${si}-${pi}`}
              x={x}
              y={VIEW_H - h}
              width={Math.max(0.5, barW)}
              height={Math.max(0, h)}
              fill={palette[si % palette.length]}
            />
          )
        }),
      )}
    </>
  )
}

function Lines({
  series,
  cats,
  max,
  palette,
  area,
}: {
  series: { name: string; points: ChartDatum[] }[]
  cats: string[]
  max: number
  palette: string[]
  area: boolean
}): React.ReactElement {
  const step = cats.length > 1 ? VIEW_W / (cats.length - 1) : VIEW_W
  return (
    <>
      {series.map((s, si) => {
        const pts = s.points
          .map((p) => {
            const at = cats.indexOf(p.x)
            if (at < 0) return null
            const x = cats.length > 1 ? at * step : VIEW_W / 2
            const y = VIEW_H - (Math.max(0, p.y) / max) * (VIEW_H - 2)
            return `${x},${y}`
          })
          .filter((v): v is string => v !== null)
        if (pts.length === 0) return null
        const colour = palette[si % palette.length]
        // A single point has no line to draw — a dot is the honest rendering, and without
        // this a one-row series plots as an invisible zero-length polyline.
        if (pts.length === 1) {
          const [x, y] = pts[0].split(',').map(Number)
          return <Prim.Circle key={si} cx={x} cy={y} r={1.5} fill={colour} />
        }
        return (
          <React.Fragment key={si}>
            {area ? (
              <Prim.Polygon
                points={`0,${VIEW_H} ${pts.join(' ')} ${VIEW_W},${VIEW_H}`}
                fill={colour}
                fillOpacity={0.15}
                stroke="none"
              />
            ) : null}
            <Prim.Polyline points={pts.join(' ')} fill="none" stroke={colour} strokeWidth={1} />
          </React.Fragment>
        )
      })}
    </>
  )
}

/**
 * Donut slices as arc paths plus a punched centre.
 *
 * `strokeDasharray` is the usual web trick and is exactly the wrong one here: RNSVG's parsing
 * of a dash string differs from the browser's, so the slices would land in different places on
 * the two targets. An `A` arc command means the same thing to both.
 */
function DonutSlices({
  series,
  palette,
}: {
  series: { name: string; points: ChartDatum[] }[]
  palette: string[]
}): React.ReactElement {
  const flat = series.flatMap((s, si) => s.points.map((p, pi) => ({ ...p, colour: palette[(si + pi) % palette.length] })))
  const total = flat.reduce((sum, p) => sum + Math.max(0, p.y), 0)
  const cx = VIEW_W / 2
  const cy = VIEW_H / 2
  const r = Math.min(VIEW_W, VIEW_H) / 2 - 2
  const bg = useColorValue('$card')

  if (total <= 0) return <Prim.Circle cx={cx} cy={cy} r={r} fill={palette[0]} fillOpacity={0.2} />

  let angle = -Math.PI / 2
  const paths = flat.map((p, i) => {
    const sweep = (Math.max(0, p.y) / total) * Math.PI * 2
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    angle += sweep
    const x2 = cx + r * Math.cos(angle)
    const y2 = cy + r * Math.sin(angle)
    const large = sweep > Math.PI ? 1 : 0
    // A single 100% slice cannot be drawn as one arc (start === end); a full circle is.
    const d =
      flat.length === 1
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
    return <Prim.Path key={i} d={d} fill={p.colour} />
  })

  return (
    <>
      {paths}
      <Prim.Circle cx={cx} cy={cy} r={r * 0.55} fill={bg} />
    </>
  )
}
