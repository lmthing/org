/**
 * Line clamping, in the one form that works on BOTH targets.
 *
 * Web wants the `-webkit-line-clamp` trio; React Native wants `numberOfLines`, which Tamagui
 * forwards. Returning an untyped prop bag rather than a typed object is deliberate: the web
 * `Text` primitive's props do not include `numberOfLines` (it is meaningless to a `<span>`),
 * so a typed return would fail the web build for a prop the native build requires.
 *
 * Its own module because `elements.tsx`, `calendar.tsx` and `charts.tsx` all need it and
 * `elements.tsx` imports the other two — putting it there would be an import cycle.
 */
export function clampProps(maxLines: number): Record<string, unknown> {
  return {
    numberOfLines: maxLines,
    display: '-webkit-box',
    overflow: 'hidden',
    style: { WebkitLineClamp: maxLines, WebkitBoxOrient: 'vertical' },
  }
}
