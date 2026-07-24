/** presentation.styled.tsx — P2 conversion of the `.slide` / `.presentation` BEM blocks
 *  (docs/tamagui-idiomatic-migration.md §4). One styled() per BEM selector; modifiers → variants.
 *  Lands alongside the shipped className presentation components. Frame names are globally-unique
 *  `Presentation*`.
 *
 *  Note on rounded-2xl / rounded-3xl: Tailwind's 1rem / 1.5rem radii have no `$radius-*` token
 *  (the scale stops at radius-xl), so they map to the literal px (16 / 24). Arbitrary em
 *  letter-spacings and unitless line-heights are cast strings. `transition-*`/`animation` await the
 *  animation driver (§5/P4). */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/** `.slide` — flex! h-full w-full flex-col + layout modifiers as boolean variants. */
export const PresentationSlideFrame = styled(View, {
  name: 'PresentationSlide',
  display: 'flex',
  height: '100%',
  width: '100%',
  flexDirection: 'column',
  variants: {
    centered: {
      // .slide--centered
      true: { alignItems: 'center', justifyContent: 'center' },
    },
    padded: {
      // .slide--padded — 3rem 4rem 3rem
      true: { paddingTop: '$12', paddingHorizontal: '$16', paddingBottom: '$12' },
    },
    paddedLg: {
      // .slide--padded-lg — 48px 72px 52px
      true: { paddingTop: 48, paddingHorizontal: 72, paddingBottom: 52 },
    },
    paddedXl: {
      // .slide--padded-xl — 60px 80px 56px
      true: { paddingTop: 60, paddingHorizontal: 80, paddingBottom: 56 },
    },
    row: {
      // .slide--row — flex-row items-center; padding:0 4rem
      true: { flexDirection: 'row', alignItems: 'center', paddingVertical: 0, paddingHorizontal: '$16' },
    },
  } as const,
})

/** `.slide__section-label` — font-bold uppercase tracking-[0.16em] + `--sm/--md/--lg` size variant. */
export const PresentationSectionLabelFrame = styled(Text, {
  name: 'PresentationSectionLabel',
  fontWeight: '$bold',
  textTransform: 'uppercase',
  letterSpacing: '0.16em' as unknown as number, // tracking-[0.16em]
  variants: {
    size: {
      sm: { fontSize: '$lg' }, // text-lg
      md: { fontSize: '$xl' }, // text-xl
      lg: { fontSize: '$2xl' }, // text-2xl
    },
  } as const,
})

/** `.slide__headline` — font-bold leading-tight tracking-tight + `--xl/--lg/--md/--sm` size variant. */
export const PresentationHeadlineFrame = styled(Text, {
  name: 'PresentationHeadline',
  fontWeight: '$bold',
  lineHeight: '1.25' as unknown as number, // leading-tight
  letterSpacing: '$tight',
  variants: {
    size: {
      // --xl: text-6xl sm:text-7xl
      xl: { fontSize: '$6xl', $gtXs: { fontSize: '$7xl' } },
      // --lg: text-6xl font-extrabold leading-[1.15]; letter-spacing:-0.025em
      lg: {
        fontSize: '$6xl',
        fontWeight: '$extrabold',
        lineHeight: '1.15' as unknown as number,
        letterSpacing: '-0.025em' as unknown as number,
      },
      md: { fontSize: '$5xl' }, // text-5xl
      sm: { fontSize: '$4xl' }, // text-4xl
    },
  } as const,
})

/** `.slide__subtitle` — text-xl + `--lg` variant (text-2xl leading-relaxed). */
export const PresentationSubtitleFrame = styled(Text, {
  name: 'PresentationSubtitle',
  fontSize: '$xl',
  variants: {
    size: {
      lg: { fontSize: '$2xl', lineHeight: '1.625' as unknown as number }, // leading-relaxed
    },
  } as const,
})

/** `.slide__badge` — rounded-full border-2 px-5 py-1.5 text-sm font-semibold tracking-wide. */
export const PresentationBadgeFrame = styled(Text, {
  name: 'PresentationBadge',
  borderRadius: '$radius-full',
  borderWidth: 2,
  paddingHorizontal: '$5',
  paddingVertical: '$1.5',
  fontSize: '$sm',
  fontWeight: '$semibold',
  letterSpacing: '$wide',
})

/** `.slide__pill` — rounded-full border-2 px-6 py-3 text-lg font-medium + `--sm/--lg` variant. */
export const PresentationPillFrame = styled(Text, {
  name: 'PresentationPill',
  borderRadius: '$radius-full',
  borderWidth: 2,
  paddingHorizontal: '$6',
  paddingVertical: '$3',
  fontSize: '$lg',
  fontWeight: '$medium',
  variants: {
    size: {
      // --sm: px-3 py-1 text-xs font-semibold
      sm: { paddingHorizontal: '$3', paddingVertical: '$1', fontSize: '$xs', fontWeight: '$semibold' },
      // --lg: px-7 py-3.5 text-lg font-semibold
      lg: { paddingHorizontal: '$7', paddingVertical: '$3.5', fontSize: '$lg', fontWeight: '$semibold' },
    },
  } as const,
})

/** `.slide__flow-row` — flex! items-center; gap:1.5rem. */
export const PresentationFlowRowFrame = styled(View, {
  name: 'PresentationFlowRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$6',
})

/** `.slide__flow-node` — rounded-full border; font-size:1.4rem; padding:0.85rem 1.75rem +
 *  `--hero`/`--regular` variants. */
export const PresentationFlowNodeFrame = styled(View, {
  name: 'PresentationFlowNode',
  borderRadius: '$radius-full',
  borderWidth: 1,
  fontSize: 22.4, // 1.4rem, no token
  paddingVertical: 13.6, // 0.85rem, no token
  paddingHorizontal: '$7', // 1.75rem
  variants: {
    kind: {
      hero: {
        // --hero: border-2; 1.625rem/800; 24px 40px; radius 20px; shadow; +0.02em; height 76px
        borderWidth: 2,
        fontSize: 26, // 1.625rem
        fontWeight: '$extrabold',
        paddingVertical: 24,
        paddingHorizontal: 40,
        borderRadius: 20,
        shadowColor: 'rgba(0,0,0,0.12)',
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 32,
        letterSpacing: '0.02em' as unknown as number,
        height: 76,
      },
      regular: {
        // --regular: padding:0 32px; height:76px; flex center; nowrap; rounded-2xl; border-2; text-xl semibold
        paddingVertical: 0,
        paddingHorizontal: 32,
        height: 76,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        whiteSpace: 'nowrap',
        borderRadius: 16, // rounded-2xl, no token
        borderWidth: 2,
        fontSize: '$xl',
        fontWeight: '$semibold',
      },
    },
  } as const,
})

/** `.slide__flow-sub` — max-w-[160px] text-center text-base leading-snug + `--hero` variant. */
export const PresentationFlowSubFrame = styled(Text, {
  name: 'PresentationFlowSub',
  maxWidth: 160, // max-w-[160px]
  textAlign: 'center',
  fontSize: '$base',
  lineHeight: '1.375' as unknown as number, // leading-snug
  variants: {
    kind: {
      // --hero: 600; 15px; +0.06em; uppercase
      hero: {
        fontWeight: '$semibold',
        fontSize: 15,
        letterSpacing: '0.06em' as unknown as number,
        textTransform: 'uppercase',
      },
    },
  } as const,
})

/** `.slide__chip` — rounded-lg; 1.25rem/700; padding:0.65rem 1.4rem; 4px left rule; +0.02em. */
export const PresentationChipFrame = styled(Text, {
  name: 'PresentationChip',
  borderRadius: '$radius-lg',
  fontSize: '$xl', // 1.25rem
  fontWeight: '$bold',
  paddingVertical: 10.4, // 0.65rem, no token
  paddingHorizontal: 22.4, // 1.4rem, no token
  borderLeftWidth: 4,
  borderLeftStyle: 'solid',
  letterSpacing: '0.02em' as unknown as number,
})

/** `.slide__card` — relative flex! flex-col overflow-hidden rounded-2xl border; padding:1.75rem 1.75rem 2rem. */
export const PresentationCardFrame = styled(View, {
  name: 'PresentationCard',
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderRadius: 16, // rounded-2xl, no token
  borderWidth: 1,
  paddingTop: '$7', // 1.75rem
  paddingHorizontal: '$7',
  paddingBottom: '$8', // 2rem
})

/** `.slide__card-accent` — absolute left-0 right-0 top-0; height:3px; border-radius:16px 16px 0 0. */
export const PresentationCardAccentFrame = styled(View, {
  name: 'PresentationCardAccent',
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  height: 3,
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
})

/** `.slide__strip` — flex! items-center gap-2.5 rounded-full px-8 py-3.5. */
export const PresentationStripFrame = styled(View, {
  name: 'PresentationStrip',
  display: 'flex',
  alignItems: 'center',
  gap: '$2.5',
  borderRadius: '$radius-full',
  paddingHorizontal: '$8',
  paddingVertical: '$3.5',
})

/** `.slide__strip-dot` — h-1.5 w-1.5 flex-shrink-0 rounded-full. */
export const PresentationStripDotFrame = styled(View, {
  name: 'PresentationStripDot',
  height: '$1.5',
  width: '$1.5',
  flexShrink: 0,
  borderRadius: '$radius-full',
})

/** `.slide__strip-text` — text-base font-medium tracking-wide. */
export const PresentationStripTextFrame = styled(Text, {
  name: 'PresentationStripText',
  fontSize: '$base',
  fontWeight: '$medium',
  letterSpacing: '$wide',
})

/** `.slide__divider` — h-px w-full. */
export const PresentationDividerFrame = styled(View, {
  name: 'PresentationDivider',
  height: 1, // h-px
  width: '100%',
})

/** `.slide__grid-3` — grid! w-full grid-cols-3 gap-5. */
export const PresentationGrid3Frame = styled(View, {
  name: 'PresentationGrid3',
  display: 'grid',
  width: '100%',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: '$5',
})

/** `.slide__grid-split` — grid! w-full gap-x-9; grid-template-columns:1fr 1px 1fr. */
export const PresentationGridSplitFrame = styled(View, {
  name: 'PresentationGridSplit',
  display: 'grid',
  width: '100%',
  columnGap: '$9',
  gridTemplateColumns: '1fr 1px 1fr',
})

/** `.slide__screenshot` — rounded-2xl border p-2; box-shadow (opaque-black low-alpha). */
export const PresentationScreenshotFrame = styled(View, {
  name: 'PresentationScreenshot',
  borderRadius: 16, // rounded-2xl, no token
  borderWidth: 1,
  padding: '$2',
  shadowColor: 'rgba(0,0,0,0.08)',
  shadowOffset: { width: 0, height: 8 },
  shadowRadius: 32,
})

/** `.slide__screenshot-img` — w-full rounded-2xl. */
export const PresentationScreenshotImgFrame = styled(View, {
  name: 'PresentationScreenshotImg',
  width: '100%',
  borderRadius: 16, // rounded-2xl, no token
})

/** `.slide__video-container` — flex! w-full max-w-6xl items-center justify-center. */
export const PresentationVideoContainerFrame = styled(View, {
  name: 'PresentationVideoContainer',
  display: 'flex',
  width: '100%',
  maxWidth: 1152, // max-w-6xl (72rem)
  alignItems: 'center',
  justifyContent: 'center',
})

/** `.slide__video` — w-full rounded-2xl shadow-2xl; max-height:65vh. */
export const PresentationVideoFrame = styled(View, {
  name: 'PresentationVideo',
  width: '100%',
  borderRadius: 16, // rounded-2xl, no token
  // shadow-2xl single-layer approximation (opaque-black moderate-alpha)
  shadowColor: 'rgba(0,0,0,0.25)',
  shadowOffset: { width: 0, height: 25 },
  shadowRadius: 50,
  maxHeight: '65vh',
})

/** `.slide__team-grid` — flex! gap-16. */
export const PresentationTeamGridFrame = styled(View, {
  name: 'PresentationTeamGrid',
  display: 'flex',
  gap: '$16',
})

/** `.slide__team-member` — flex! flex-col items-center. */
export const PresentationTeamMemberFrame = styled(View, {
  name: 'PresentationTeamMember',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
})

/** `.slide__team-photo` — size-40 rounded-full border-4 object-cover. */
export const PresentationTeamPhotoFrame = styled(View, {
  name: 'PresentationTeamPhoto',
  width: '$40',
  height: '$40',
  borderRadius: '$radius-full',
  borderWidth: 4,
  objectFit: 'cover',
})

/** `.slide__qr` — h-80 w-80 rounded-3xl shadow-xl. */
export const PresentationQrFrame = styled(View, {
  name: 'PresentationQr',
  height: '$80',
  width: '$80',
  borderRadius: 24, // rounded-3xl, no token
  // shadow-xl single-layer approximation (opaque-black low-alpha)
  shadowColor: 'rgba(0,0,0,0.1)',
  shadowOffset: { width: 0, height: 20 },
  shadowRadius: 25,
})

/** `.slide__tier-item` — flex! items-center gap-3 rounded-xl border px-4 py-3. */
export const PresentationTierItemFrame = styled(View, {
  name: 'PresentationTierItem',
  display: 'flex',
  alignItems: 'center',
  gap: '$3',
  borderRadius: '$radius-xl', // rounded-xl
  borderWidth: 1,
  paddingHorizontal: '$4',
  paddingVertical: '$3',
})

/** `.slide__tier-dot` — h-2.5 w-2.5 flex-shrink-0 rounded-full. */
export const PresentationTierDotFrame = styled(View, {
  name: 'PresentationTierDot',
  height: '$2.5',
  width: '$2.5',
  flexShrink: 0,
  borderRadius: '$radius-full',
})

/** `.slide__tier-name` — w-28 flex-shrink-0 text-base font-bold. */
export const PresentationTierNameFrame = styled(Text, {
  name: 'PresentationTierName',
  width: '$28',
  flexShrink: 0,
  fontSize: '$base',
  fontWeight: '$bold',
})

/** `.slide__tier-desc` — flex-1 text-sm leading-snug. */
export const PresentationTierDescFrame = styled(Text, {
  name: 'PresentationTierDesc',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  fontSize: '$sm',
  lineHeight: '1.375' as unknown as number, // leading-snug
})

/** `.slide__tier-tag` — flex-shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold. */
export const PresentationTierTagFrame = styled(Text, {
  name: 'PresentationTierTag',
  flexShrink: 0,
  whiteSpace: 'nowrap',
  borderRadius: '$radius-full',
  paddingHorizontal: '$3',
  paddingVertical: '$1',
  fontSize: '$xs',
  fontWeight: '$semibold',
})

/** `.slide__point` — flex! items-start gap-3. */
export const PresentationPointFrame = styled(View, {
  name: 'PresentationPoint',
  display: 'flex',
  alignItems: 'flex-start',
  gap: '$3',
})

/** `.slide__point-icon` — flex! h-10 w-10 flex-shrink-0 items-center justify-center rounded-[9px] border text-xl. */
export const PresentationPointIconFrame = styled(View, {
  name: 'PresentationPointIcon',
  display: 'flex',
  height: '$10',
  width: '$10',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 9, // rounded-[9px]
  borderWidth: 1,
  fontSize: '$xl',
})

/** `.presentation` — relative h-screen w-screen overflow-hidden; background token. */
export const PresentationShellFrame = styled(View, {
  name: 'PresentationShell',
  position: 'relative',
  height: '100vh',
  width: '100vw',
  overflow: 'hidden',
  backgroundColor: '$background',
})

/** `.presentation__exit-btn` — absolute right-6 top-6 z-50 flex! size-10 centered rounded-full;
 *  translucent-black icon + hover tint. transition-colors awaits the animation driver (§5/P4). */
export const PresentationExitBtnFrame = styled(View, {
  name: 'PresentationExitBtn',
  position: 'absolute',
  right: '$6',
  top: '$6',
  zIndex: 50,
  display: 'flex',
  width: '$10',
  height: '$10',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$radius-full',
  color: 'rgba(0,0,0,0.3)', // translucent-black, no token
  hoverStyle: { backgroundColor: 'rgba(0,0,0,0.05)' },
})

/** `.presentation__slide` — h-full w-full; animation:fade-in awaits the animation driver (§5/P4). */
export const PresentationSlideAnimFrame = styled(View, {
  name: 'PresentationSlideAnim',
  height: '100%',
  width: '100%',
})

/** `.presentation__nav-overlay` — absolute inset-0 z-40. */
export const PresentationNavOverlayFrame = styled(View, {
  name: 'PresentationNavOverlay',
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 40,
})

/** `.presentation__counter` — absolute bottom-6 right-6 z-50 text-sm font-medium; translucent-black. */
export const PresentationCounterFrame = styled(Text, {
  name: 'PresentationCounter',
  position: 'absolute',
  bottom: '$6',
  right: '$6',
  zIndex: 50,
  fontSize: '$sm',
  fontWeight: '$medium',
  color: 'rgba(0,0,0,0.3)', // translucent-black, no token
})

/** `.presentation__footer` — absolute bottom-5 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap text-sm. */
export const PresentationFooterFrame = styled(Text, {
  name: 'PresentationFooter',
  position: 'absolute',
  bottom: '$5',
  left: '50%',
  zIndex: 50,
  transform: 'translateX(-50%)', // -translate-x-1/2
  whiteSpace: 'nowrap',
  fontSize: '$sm',
  color: '$muted-foreground',
})

export interface StyledSlideProps extends React.ComponentProps<'div'> {
  centered?: boolean
  padded?: boolean
  paddedLg?: boolean
  paddedXl?: boolean
  row?: boolean
}

const Frame = PresentationSlideFrame as unknown as React.ComponentType<any>

/** Idiomatic Slide — the `.slide` base frame with its layout modifier variants. */
export function StyledSlide({ centered, padded, paddedLg, paddedXl, row, ...props }: StyledSlideProps) {
  return <Frame centered={centered} padded={padded} paddedLg={paddedLg} paddedXl={paddedXl} row={row} {...props} />
}
