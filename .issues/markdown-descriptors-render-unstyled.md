# `display`/`markdown` descriptors render unstyled — the `prose` classes never worked

**Symptom.** Markdown rendered by `chat/components/DisplayBlock.tsx` (the `markdown` display block)
and by `chat/components/render-descriptor.tsx` (the `markdown` descriptor) has **no styling at all**:
no heading scale, no code-block background, no list indentation.

**Attribution.** Both carried `@tailwindcss/typography` classNames:

```
className="prose prose-sm"
className="prose prose-sm prose-headings:text-lm-text prose-a:text-lm-accent
           prose-code:text-lm-cyan prose-code:bg-lm-bg prose-pre:bg-lm-bg
           prose-pre:border prose-pre:border-lm-border"
```

**`@tailwindcss/typography` is not installed and never was** — `@plugin` appears in no stylesheet, and
the plugin is in no `package.json`. So Tailwind generated nothing for any of them. Verified against the
pre-phase-4 bundle: it contains **zero** `.prose` rules; the only match for "prose" is our own
hand-written `.lm-prose`.

The intent is unmistakable from the `prose-code:text-lm-cyan`-style variants — someone wrote a full
token-mapped typography treatment that has been inert since it was written.

**Fix.** `.lm-prose` (`libs/css/src/components/markdown/index.css`) is the working class for exactly
this content — `marked`-produced HTML injected via `dangerouslySetInnerHTML` — and is what
`chat/app/Message.tsx` already uses. Apply it to both sites and side-effect-import the stylesheet, as
`Message.tsx` does. `.lm-markdown` in the same file is the other candidate; it has a different spacing
and type scale, so pick per surface rather than assuming.

Phase 4 removed the dead classNames (behaviour-neutral) but deliberately did **not** apply `.lm-prose`:
that is a visible change to two surfaces and would have muddied the phase's P0 delta.

**Verify:** a `display({ kind: 'markdown' })` block and a `markdown` descriptor both render with the
same heading/code/list treatment as a normal chat message.
