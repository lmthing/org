// Design-system tokens for the pitch deck. Decorative accents map to the brand
// palette; text/surfaces/borders map to the semantic foreground/muted/card/border
// tokens. Values are CSS var() references so they inherit theme + dark mode.
// Note: when used on SVG presentation attributes (stroke/fill), set them via the
// `style` prop, not the XML attribute — var() only resolves through CSS.
export const colors = {
  bg: 'var(--background)',
  bgSection: 'var(--muted)',
  bgCard: 'var(--card)',
  bgDark: 'var(--foreground)',
  brand: 'var(--brand-2)',
  brandDark: 'var(--brand-3)',
  text: 'var(--foreground)',
  textSecondary: 'var(--muted-foreground)',
  cardBorder: 'var(--border)',
  green: 'var(--success)',
  purple: 'var(--agent)',
  white: 'var(--card)',
  muted: 'var(--muted-foreground)',
} as const
