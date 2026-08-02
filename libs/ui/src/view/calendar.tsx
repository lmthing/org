/**
 * `calendar` — dated rows as a month GRID.
 *
 * The date-as-grid sibling of `timeline`'s date-as-stream: the same rows, arranged for the
 * question "what does this month look like" rather than "what happened next". One
 * implementation, shared by the `calendar` ELEMENT (inside a card or a component) and the
 * `calendar` SECTION (a page's own surface), so the two can never drift.
 *
 * ## Rules the grid keeps, and why each is a rule rather than a nicety
 *
 *  - **A row whose date does not parse is not dropped.** It lands in an "undated" tray under
 *    the grid. Dropping it is how a calendar tells a user they have nothing on a day they in
 *    fact have something on, which is worse than an ugly list.
 *  - **The month is derived from the data** when it is not named, using the EARLIEST entry —
 *    not `today`. A generated app is routinely opened against seeded rows from another month,
 *    and a calendar that defaults to an empty current month is indistinguishable from a broken
 *    endpoint.
 *  - **Dates are read in UTC** (`getUTCDate`, not `getDate`). `format.ts#toDate` parses a
 *    date-only string as UTC midnight; reading it back with local getters lands it on the
 *    previous day for every user west of Greenwich — the app is told one day and shows another.
 *  - **Weeks start Monday.** One fixed convention beats a locale guess a spec cannot express.
 */

import * as React from 'react'
import * as Prim from '../elements/primitives/index'
import { toneTokens } from './format'
import { clampProps } from './clamp'
import type { Tone } from './types'

/** One dated thing on the grid. */
export interface CalendarEntry {
  /** Already parsed — `null` means the source did not carry a usable date. */
  date: Date | null
  label: string
  tone?: Exclude<Tone, 'auto'>
  onPress?: () => void
}

export interface CalendarGridProps {
  entries: CalendarEntry[]
  /** Which month to draw. Absent ⇒ the month of the earliest dated entry, else today's. */
  month?: Date | null
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Monday-first index (0–6) for a UTC date. */
function weekdayIndex(d: Date): number {
  return (d.getUTCDay() + 6) % 7
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
}

function monthLabel(d: Date): string {
  return `${d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`
}

export function CalendarGrid({ entries, month }: CalendarGridProps): React.ReactElement {
  const dated = entries.filter((e): e is CalendarEntry & { date: Date } => e.date !== null)
  const undated = entries.filter((e) => e.date === null)

  const anchor =
    month ??
    (dated.length > 0
      ? dated.reduce((min, e) => (e.date.getTime() < min.getTime() ? e.date : min), dated[0].date)
      : new Date())

  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
  const daysInMonth = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate()
  const lead = weekdayIndex(first)

  // A fixed 6×7 frame would add a trailing blank week most months; sizing to the content
  // keeps the grid tight on a phone, where vertical space is the scarce thing.
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const byDay = new Map<number, CalendarEntry[]>()
  for (const e of dated) {
    if (!sameMonth(e.date, anchor)) continue
    const day = e.date.getUTCDate()
    const list = byDay.get(day)
    if (list) list.push(e)
    else byDay.set(day, [e])
  }

  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <Prim.Col gap="$2" width="100%">
      <Prim.Text fontSize="$sm" fontWeight="$semibold" color="$foreground">
        {monthLabel(anchor)}
      </Prim.Text>

      <Prim.Row>
        {DAY_LABELS.map((d) => (
          <Prim.Box key={d} flexGrow={1} flexShrink={1} flexBasis="0%" paddingVertical="$1">
            <Prim.Text fontSize="$xs" color="$muted-foreground">
              {d}
            </Prim.Text>
          </Prim.Box>
        ))}
      </Prim.Row>

      <Prim.Col gap="$1">
        {weeks.map((week, wi) => (
          <Prim.Row key={wi} gap="$1" alignItems="stretch">
            {week.map((day, di) => (
              <Prim.Col
                key={di}
                flexGrow={1}
                flexShrink={1}
                flexBasis="0%"
                minHeight={56}
                gap="$0.5"
                padding="$1"
                borderWidth={1}
                borderColor="$border"
                borderRadius="$radius"
                backgroundColor={day === null ? 'transparent' : '$card'}
              >
                {day === null ? null : (
                  <>
                    <Prim.Text fontSize="$xs" color="$muted-foreground">
                      {String(day)}
                    </Prim.Text>
                    {(byDay.get(day) ?? []).map((e, ei) => (
                      <CalendarChip key={ei} entry={e} />
                    ))}
                  </>
                )}
              </Prim.Col>
            ))}
          </Prim.Row>
        ))}
      </Prim.Col>

      {undated.length > 0 ? (
        <Prim.Col gap="$1">
          <Prim.Text fontSize="$xs" color="$muted-foreground">
            No date
          </Prim.Text>
          {undated.map((e, i) => (
            <CalendarChip key={i} entry={e} />
          ))}
        </Prim.Col>
      ) : null}
    </Prim.Col>
  )
}

/**
 * One entry inside a day cell.
 *
 * `Prim.Pressable` rather than a styled Box even when there is no handler: a chip that is
 * sometimes pressable and sometimes not would otherwise be two different host components on
 * native, and the press target would move between them.
 */
function CalendarChip({ entry }: { entry: CalendarEntry }): React.ReactElement {
  const t = toneTokens(entry.tone ?? 'neutral')
  return (
    <Prim.Pressable
      onClick={entry.onPress}
      backgroundColor={t.bg}
      borderRadius="$radius-sm"
      paddingHorizontal="$1"
      paddingVertical="$0.5"
    >
      <Prim.Text fontSize="$xs" color={t.fg} {...clampProps(1)}>
        {entry.label}
      </Prim.Text>
    </Prim.Pressable>
  )
}
