# `pnpm shots` — pictures of the real team and chat surfaces

```bash
pnpm shots                                            # build + shoot everything
node tests/surface-shots/shoot.mjs --fx team-long     # one fixture
node tests/surface-shots/shoot.mjs --only phone       # one viewport
```

PNGs land in `__shots__/` (gitignored). Phone is 390×844, desktop 1440×900, both
themes. **Look at them** — that is the point.

## Why this exists

Every other gate in this repo is blind to layout. `renderToStaticMarkup` + jsdom
do no layout at all, the accessibility tree happily lists content that is painted
nowhere, and the Metro gate proves modules RESOLVE, not that they mount. A
surface can be completely blank, or unscrollable, with the whole suite green.

That is not hypothetical. In the session this was written:

- **every markdown list in the web app had no bullets and no numbers.**
  `markdown/render.tsx` deliberately left web "on the browser's own native
  marker", and `preflight.css` resets `list-style: none` on every `ol`/`ul`. A
  numbered list read as four unlabelled indented lines. The text was all present
  in the DOM and in the a11y tree, and jsdom has no marker box to measure.
- **a transcript silently stopped scrolling.** A `position: relative` wrapper
  (`Prim.Box`, which computes to `display: block`) between the flex column and
  the `Scroll` made the Scroll's `flex={1}` meaningless, so it sized to its
  content: 3804px of messages in an 844px window, `clientHeight ===
  scrollHeight`, composer painted over the last message, newest messages
  unreachable. Every gate stayed green.

## How it can mount the real thing

Both surfaces already have a clean seam, so no pod and no backend are needed:

- **team** — `TeamChannelsView` takes `client: TeamClient`, so an in-memory fake
  drives the whole surface (`harness/fixtures.tsx#fakeTeamClient`).
- **chat** — the store is plain Zustand, so `useStore.setState` seeds a
  transcript and `ChatView` renders with no socket.

`entry.tsx` mounts ONE fixture per page load, filling the viewport, so a
container that collapses shows up as a blank picture instead of hiding inside a
stacked stage. It also stubs `WebSocket`, so a failing dial does not put a red
error state in every shot.

## What it fails the build on

Only things a machine can honestly judge:

- the stage collapsed, nothing painted, or no text rendered
- horizontal overflow at phone width
- **the page itself scrolls** — these are fixed-height shells, so that means a
  height constraint stopped being passed down
- any `overflow-y: auto` region taller than the viewport (it grew to its content
  instead of scrolling)
- on the deliberately-overflowing `team-long` fixture: that the FIRST message is
  still reachable at `scrollTop 0`. Bottom-anchoring a scroll region with
  `justify-content: flex-end` makes the start-direction overflow unreachable,
  and nothing about the bottom of the list looks wrong when it happens.

`/api/*` request failures are expected and filtered — there is no backend here
on purpose.

## Gotchas

- Animations are settled at their **END** (`a.finish()`), not `currentTime = 0`
  the way `visual-surface/capture.mjs` freezes them. That harness wants stable
  computed values; this one wants a picture, and a fading-in transcript frozen
  at 0 photographs as invisible.
- Chromium is resolved from `~/.cache/ms-playwright`, with `/opt/pw-browsers`
  as a fallback and `PW_CHROMIUM` as an override. Do **not** run
  `playwright install`.
- Only a FULL run clears `__shots__/`; a filtered run leaves the others in place
  so there is something to compare against.

## Not this harness's job

`tests/visual-surface/` captures **computed style** over the primitives and
answers "did the token migration change output". This one takes **pictures** of
composed product screens. They are complements, and adding fixtures here does
not touch that baseline.
