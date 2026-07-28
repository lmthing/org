/**
 * The entry is deliberately NOT forked.
 *
 * `libs/ui`'s `./elements/*` export maps straight to `index.tsx`, so a consumer reaching a forked
 * element through that subpath names the WEB file and Metro never gets to prefer `index.native.tsx`
 * — `apps/mobile` opened a project app and React Native tried to mount an `<iframe>`. Making the
 * export condition platform-aware does not work either: Metro does not fall through a conditional
 * array when the first pattern has no file, which breaks every element that has no fork.
 *
 * So the entry is a plain re-export and the fork sits one level in, behind a RELATIVE specifier —
 * which is exactly where platform resolution does work, and is why every other fork in this package
 * (imported relatively from inside it) has never hit this.
 *
 * It is `.tsx` and not `.ts` despite holding no JSX: the export map's first pattern for an element
 * ends in `index.tsx`, and Metro tries only that one — it does not fall through the rest of the
 * array the way Node does.
 */
export { AppView } from './view'
