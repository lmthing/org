#!/usr/bin/env python3
"""
Generate every raster brand asset this app ships, from the design tokens.

    python3 scripts/generate-icons.py          # needs Pillow (pip install pillow)

The launcher icon, the splash mark, the notification silhouette and the two Play
Store listing images are all the SAME wordmark, so they are all generated from one
place rather than hand-cut in an image editor. Colours are read from
`libs/css/src/tokens/tokens.json` — the same file `pnpm --filter @lmthing/css
generate` reads — so a brand colour cannot mean one thing on the web and another on
the home screen, and re-running this after a token change is the whole update.

The mark itself is `lmt` in the repo's own Cera Round Pro Bold, with the per-letter
colours `CozyThingText` uses
(`libs/ui/src/elements/branding/cozy-text/index.tsx`), on the dark-theme
`background`. It is set on the dark ground rather than the light one because the
48dp launcher size is the size that decides an icon: the light variants of the same
mark wash out against a pale wallpaper, and the rose `l` stops being legible.

Outputs (all committed — CI does not run Python):

    assets/icon.png             1024²  full-bleed. iOS, Android legacy, Expo fallback.
    assets/adaptive-icon.png    1024²  Android foreground layer, transparent ground.
    assets/splash-icon.png      1024²  splash mark, transparent ground.
    assets/notification-icon.png  96²  Android status bar. ALPHA ONLY — Android
                                       throws away the colours and tints the shape.
    store/icon-512.png           512²  Play listing icon. 32-bit, no alpha (Play rejects it).
    store/feature-graphic.png  1024×500  Play listing header.
"""

# Pillow ships no type stubs, so a strict checker reports every call through it as
# partially unknown — including a false positive on `Image.new(..., color=tuple)`,
# which is the documented signature. This is a build-time asset script, not shipped
# code; silencing the family here beats scattering ignores over every draw call.
# pyright: reportMissingTypeStubs=false, reportUnknownMemberType=false
# pyright: reportUnknownVariableType=false, reportUnknownArgumentType=false
# pyright: reportUnknownParameterType=false, reportMissingParameterType=false
# pyright: reportArgumentType=false, reportAny=false, reportExplicitAny=false
# pyright: reportAttributeAccessIssue=false, reportUnusedCallResult=false

import json
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ORG = os.path.dirname(os.path.dirname(APP))

TOKENS = os.path.join(ORG, "libs/css/src/tokens/tokens.json")
FONT_PATH = os.path.join(ORG, "apps/web/public/TypeMates  Cera Round Pro Bold.otf")

# Supersample before downscaling: Pillow renders OTF outlines without any
# antialiasing worth the name at 1024px, and the rounded terminals of this
# typeface are exactly where that shows.
SS = 4

# Android guarantees only a 66dp circle of the 108dp adaptive canvas is visible
# (0.611 of the canvas), and a launcher may mask to exactly that circle. What has to
# fit is the wordmark's DIAGONAL, not its width: at 0.58 wide the mark measures
# sqrt(.58² + .29²) = 0.65 corner to corner and the outer strokes of `l` and `t` are
# clipped by a round mask. 0.50 leaves the diagonal at 0.56, inside the circle.
SAFE_WIDTH = 0.50

with open(TOKENS, encoding="utf-8") as _fh:
    _tokens = {c["name"]: c for c in json.load(_fh)["colors"]}


def color(name: str, theme: str = "light") -> str:
    return _tokens[name][theme]


GROUND = color("background", "dark")
LETTERS = [("l", color("brand-4")), ("m", color("brand-3")), ("t", color("brand-1"))]


def _fit_font(draw, run: str, max_w: float, max_h: float | None = None) -> ImageFont.FreeTypeFont:
    """Largest size whose ink box fits inside `max_w` × `max_h`.

    The two budgets are separate on purpose. A single one caps a wide run by the
    shorter axis, which on the 1024×500 feature graphic meant a 260px-wide wordmark
    on a 1024px canvas.
    """
    if max_h is None:
        max_h = max_w
    lo, hi = 10, int(max(max_w, max_h) * 3)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        f = ImageFont.truetype(FONT_PATH, mid)
        box = draw.textbbox((0, 0), run, font=f)
        if (box[2] - box[0]) <= max_w and (box[3] - box[1]) <= max_h:
            lo = mid
        else:
            hi = mid - 1
    return ImageFont.truetype(FONT_PATH, lo)


def wordmark(size: int, letters, ground, width_ratio: float) -> Image.Image:
    """The mark, centred on its ink box. `ground=None` yields a transparent layer."""
    W = size * SS
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0) if ground is None else ground)
    d = ImageDraw.Draw(img)

    run = "".join(ch for ch, _ in letters)
    font = _fit_font(d, run, W * width_ratio)

    box = d.textbbox((0, 0), run, font=font)
    total = sum(d.textlength(ch, font=font) for ch, _ in letters)
    x = (W - total) / 2
    y = (W - (box[3] - box[1])) / 2 - box[1]
    for ch, col in letters:
        d.text((x, y), ch, font=font, fill=col)
        x += d.textlength(ch, font=font)

    return img.resize((size, size), Image.LANCZOS)


# The line under the mark on the Play listing header. Not invented here: it is the
# tagline lmthing.com already gives the surface this app ships
# (`com/src/routes/index.tsx`), so the store and the site say the same thing.
TAGLINE = "Your personal THING"


def feature_graphic(w: int = 1024, h: int = 500) -> Image.Image:
    """`lmthing` in full — the canonical CozyThingText rotation — over the tagline."""
    W, H = w * SS, h * SS
    img = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(img)

    letters = [("l", color("foreground", "dark")), ("m", color("foreground", "dark"))]
    letters += [(ch, color(f"brand-{i + 1}")) for i, ch in enumerate("thing")]
    run = "".join(ch for ch, _ in letters)

    mark_font = _fit_font(d, run, W * 0.62, H * 0.34)
    tag_font = _fit_font(d, TAGLINE, W * 0.52, H * 0.09)

    mark_box = d.textbbox((0, 0), run, font=mark_font)
    tag_box = d.textbbox((0, 0), TAGLINE, font=tag_font)
    mark_h = mark_box[3] - mark_box[1]
    tag_h = tag_box[3] - tag_box[1]
    gap = H * 0.07

    top = (H - (mark_h + gap + tag_h)) / 2

    total = sum(d.textlength(ch, font=mark_font) for ch, _ in letters)
    x = (W - total) / 2
    for ch, col in letters:
        d.text((x, top - mark_box[1]), ch, font=mark_font, fill=col)
        x += d.textlength(ch, font=mark_font)

    d.text(
        ((W - (tag_box[2] - tag_box[0])) / 2, top + mark_h + gap - tag_box[1]),
        TAGLINE,
        font=tag_font,
        fill=color("muted-foreground", "dark"),
    )

    return img.resize((w, h), Image.LANCZOS)


def main() -> None:
    assets = os.path.join(APP, "assets")
    store = os.path.join(APP, "store")
    os.makedirs(assets, exist_ok=True)
    os.makedirs(store, exist_ok=True)

    full = wordmark(1024, LETTERS, GROUND, width_ratio=0.68)
    full.convert("RGB").save(os.path.join(assets, "icon.png"))

    wordmark(1024, LETTERS, None, SAFE_WIDTH).save(
        os.path.join(assets, "adaptive-icon.png")
    )
    wordmark(1024, LETTERS, None, 0.72).save(os.path.join(assets, "splash-icon.png"))

    # Android keeps only the alpha of a status-bar icon and tints the result, so a
    # coloured mark would arrive as a solid white blob. Draw the silhouette instead.
    white = [(ch, "#ffffff") for ch, _ in LETTERS]
    wordmark(96, white, None, 0.86).save(os.path.join(assets, "notification-icon.png"))

    # Play rejects an alpha channel on the listing icon.
    full.convert("RGB").resize((512, 512), Image.LANCZOS).save(
        os.path.join(store, "icon-512.png")
    )
    feature_graphic().save(os.path.join(store, "feature-graphic.png"))

    print("wrote assets/ and store/ from", os.path.relpath(TOKENS, ORG))


if __name__ == "__main__":
    main()
