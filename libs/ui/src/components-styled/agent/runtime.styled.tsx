/**
 * runtime.styled.tsx — P2 conversion of the agent/runtime BEM blocks (docs §4). One styled() per BEM
 * selector; modifiers → variants. Converts libs/css/src/components/agent/runtime/index.css — the
 * AssistantList / AssistantCard / RuntimeFieldsSidebar / RuntimePanel / StructuredOutputDisplay /
 * ToolCallDisplay / ToolCallCard / ToolRunningPill / ConversationSidebar families — into idiomatic
 * Tamagui `styled()` frames using the SPIKE-A1 var-backed `$` colors + SPIKE-B Tailwind scales.
 *
 * Every `name:` is prefixed `AgentRuntime` (globally unique; drives `.is_<Name>`). Lands alongside
 * the shipped className components; runtime-styled.test.tsx pins the frames.
 *
 * transition / animate / duration utilities are OMITTED (they await the animation driver, §5/P4).
 */
import * as React from 'react'
import { styled, View, Text } from '../../theme/tamagui-web.config'

/* ── AssistantList ─────────────────────────────────────────────────── */

/** `.agent-list__header` — 72rem centered header rail. */
export const AgentRuntimeListHeaderFrame = styled(View, {
  name: 'AgentRuntimeListHeader',
  maxWidth: 1152, // 72rem — no size token, literal px
  marginHorizontal: 'auto',
})

/** `.agent-list__header-row` — flex justify-between items-center. */
export const AgentRuntimeListHeaderRowFrame = styled(View, {
  name: 'AgentRuntimeListHeaderRow',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
})

/** `.agent-list__body` — 72rem centered body rail. */
export const AgentRuntimeListBodyFrame = styled(View, {
  name: 'AgentRuntimeListBody',
  maxWidth: 1152,
  marginHorizontal: 'auto',
})

/** `.agent-list__loading` — centered flex, padding 3rem. */
export const AgentRuntimeListLoadingFrame = styled(View, {
  name: 'AgentRuntimeListLoading',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '$12',
})

/** `.agent-list__empty` — centered empty column. */
export const AgentRuntimeListEmptyFrame = styled(View, {
  name: 'AgentRuntimeListEmpty',
  display: 'flex',
  flexDirection: 'column',
  textAlign: 'center',
  padding: '$12',
})

/** `.agent-list__empty-icon` — 2.5rem icon. */
export const AgentRuntimeListEmptyIconFrame = styled(Text, {
  name: 'AgentRuntimeListEmptyIcon',
  fontSize: 40, // 2.5rem
  marginBottom: '$4',
})

/** `.agent-list__empty-caption` — 24rem centered caption. */
export const AgentRuntimeListEmptyCaptionFrame = styled(Text, {
  name: 'AgentRuntimeListEmptyCaption',
  maxWidth: '$96', // 24rem = 384px = $96
  marginHorizontal: 'auto',
})

/** `.agent-list__grid` — auto-fill min(300px) grid. */
export const AgentRuntimeListGridFrame = styled(View, {
  name: 'AgentRuntimeListGrid',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: '$4',
})

/* ── AssistantCard ────────────────────────────────────────────────── */

/** `.agent-card__button` — reset button surface (all:unset omitted; meaningful props kept). */
export const AgentRuntimeCardButtonFrame = styled(View, {
  name: 'AgentRuntimeCardButton',
  tag: 'button',
  // all: unset — not expressible as a prop; the meaningful resets are below
  cursor: 'pointer',
  display: 'block',
  width: '100%',
})

/** `.agent-card` — full-width left-aligned card body. */
export const AgentRuntimeCardFrame = styled(View, {
  name: 'AgentRuntimeCard',
  width: '100%',
  textAlign: 'left',
})

/** `.agent-card__name` — semibold name. */
export const AgentRuntimeCardNameFrame = styled(Text, {
  name: 'AgentRuntimeCardName',
  fontWeight: '$semibold',
  marginBottom: '$3',
})

/** `.agent-card__description` — 2-line webkit clamp. */
export const AgentRuntimeCardDescriptionFrame = styled(Text, {
  name: 'AgentRuntimeCardDescription',
  display: '-webkit-box',
  // -webkit-line-clamp / -webkit-box-orient — web passthrough (best-effort)
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  marginBottom: '$4',
})

/** `.agent-card__meta-row` — flex justify-between, text-xs. */
export const AgentRuntimeCardMetaRowFrame = styled(View, {
  name: 'AgentRuntimeCardMetaRow',
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 12, // 0.75rem
})

/** `.agent-card__badge` — 0.625rem badge text. */
export const AgentRuntimeCardBadgeFrame = styled(Text, {
  name: 'AgentRuntimeCardBadge',
  fontSize: 10,
})

/** `.agent-card__separator` — vertical-margin rule. */
export const AgentRuntimeCardSeparatorFrame = styled(View, {
  name: 'AgentRuntimeCardSeparator',
  tag: 'hr',
  marginVertical: '$3',
  marginHorizontal: 0,
})

/** `.agent-card__fields-warning` — warning-colored notice. */
export const AgentRuntimeCardFieldsWarningFrame = styled(Text, {
  name: 'AgentRuntimeCardFieldsWarning',
  color: '$warning',
})

/** `.agent-card__tools` — wrapped tool chips. */
export const AgentRuntimeCardToolsFrame = styled(View, {
  name: 'AgentRuntimeCardTools',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$1.5',
  marginTop: '$2',
})

/* ── RuntimeFieldsSidebar ─────────────────────────────────────────── */

/** `.runtime-fields` — 18rem left-bordered fields rail. */
export const AgentRuntimeFieldsFrame = styled(View, {
  name: 'AgentRuntimeFields',
  width: '$72', // 18rem = 288px = $72
  flexShrink: 0,
  borderLeftWidth: 1,
  borderLeftColor: '$border',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
})

/** `.runtime-fields__panel` — full-height column. */
export const AgentRuntimeFieldsPanelFrame = styled(View, {
  name: 'AgentRuntimeFieldsPanel',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
})

/** `.runtime-fields__header-row` — flex items-center. */
export const AgentRuntimeFieldsHeaderRowFrame = styled(View, {
  name: 'AgentRuntimeFieldsHeaderRow',
  display: 'flex',
  alignItems: 'center',
})

/** `.runtime-fields__header-label` — 0.8125rem label. */
export const AgentRuntimeFieldsHeaderLabelFrame = styled(Text, {
  name: 'AgentRuntimeFieldsHeaderLabel',
  fontSize: 13, // 0.8125rem
})

/** `.runtime-fields__body` — scrollable padded body. */
export const AgentRuntimeFieldsBodyFrame = styled(View, {
  name: 'AgentRuntimeFieldsBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  paddingVertical: '$3',
  paddingHorizontal: '$4',
})

/** `.runtime-fields__hint` — small hint. */
export const AgentRuntimeFieldsHintFrame = styled(Text, {
  name: 'AgentRuntimeFieldsHint',
  marginBottom: '$3',
  fontSize: 11, // 0.6875rem
})

/** `.runtime-fields__group-label` — semibold group label. */
export const AgentRuntimeFieldsGroupLabelFrame = styled(Text, {
  name: 'AgentRuntimeFieldsGroupLabel',
  fontWeight: '$semibold',
  marginBottom: '$2',
  fontSize: 11,
})

/* ── RuntimeField (individual field) ──────────────────────────────── */

/** `.runtime-fields__field-header` — flex items-center. */
export const AgentRuntimeFieldsFieldHeaderFrame = styled(View, {
  name: 'AgentRuntimeFieldsFieldHeader',
  display: 'flex',
  alignItems: 'center',
  marginBottom: '$1',
})

/** `.runtime-fields__field-label` — 0.8125rem field label. */
export const AgentRuntimeFieldsFieldLabelFrame = styled(Text, {
  name: 'AgentRuntimeFieldsFieldLabel',
  fontSize: 13,
})

/** `.runtime-fields__field-required` — warning required flag. */
export const AgentRuntimeFieldsFieldRequiredFrame = styled(Text, {
  name: 'AgentRuntimeFieldsFieldRequired',
  color: '$warning',
  fontSize: 11,
})

/** `.runtime-fields__field-description` — field description. */
export const AgentRuntimeFieldsFieldDescriptionFrame = styled(Text, {
  name: 'AgentRuntimeFieldsFieldDescription',
  marginBottom: '$1.5',
  fontSize: 11,
})

/* ── MultiSelectPills ─────────────────────────────────────────────── */

/** `.runtime-fields__pills` — wrapped pill row. */
export const AgentRuntimeFieldsPillsFrame = styled(View, {
  name: 'AgentRuntimeFieldsPills',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$1.5',
})

/** `.runtime-fields__pill` — clickable borderless pill. */
export const AgentRuntimeFieldsPillFrame = styled(View, {
  name: 'AgentRuntimeFieldsPill',
  tag: 'button',
  cursor: 'pointer',
  borderWidth: 0,
  fontSize: 11,
})

/* ── ToggleSwitch ─────────────────────────────────────────────────── */

/** `.runtime-fields__toggle` — pill toggle track + on/off surface (`--on`/`--off`). */
export const AgentRuntimeFieldsToggleFrame = styled(View, {
  name: 'AgentRuntimeFieldsToggle',
  tag: 'button',
  position: 'relative',
  width: '$10', // 2.5rem
  height: 22, // 1.375rem — no token, literal px
  borderRadius: '$radius-full',
  borderWidth: 0,
  cursor: 'pointer',
  // transition: background-color awaits the animation driver (§5/P4)

  variants: {
    state: {
      on: { backgroundColor: '$primary' }, // .runtime-fields__toggle--on
      off: { backgroundColor: '$muted' }, // .runtime-fields__toggle--off
    },
  } as const,
})

/** `.runtime-fields__toggle-thumb` — sliding thumb + on/off position (`--on`/`--off`). */
export const AgentRuntimeFieldsToggleThumbFrame = styled(View, {
  name: 'AgentRuntimeFieldsToggleThumb',
  position: 'absolute',
  top: '$0.5', // 0.125rem
  left: '$0.5',
  width: 18, // 1.125rem — no token, literal px
  height: 18,
  borderRadius: '$radius-full',
  backgroundColor: 'white', // ds-lint-ok: literal white thumb, theme-independent
  // transition: transform awaits the animation driver (§5/P4)

  variants: {
    state: {
      on: { x: 18 }, // .runtime-fields__toggle-thumb--on — translateX(1.125rem)
      off: { x: 0 }, // .runtime-fields__toggle-thumb--off — translateX(0)
    },
  } as const,
})

/* ── RuntimePanel ─────────────────────────────────────────────────── */

/** `.runtime-panel` — full-height panel column. */
export const AgentRuntimePanelFrame = styled(View, {
  name: 'AgentRuntimePanel',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
})

/** `.runtime-panel__description` — description with small top margin. */
export const AgentRuntimePanelDescriptionFrame = styled(Text, {
  name: 'AgentRuntimePanelDescription',
  marginTop: '$1',
})

/** `.runtime-panel__name` — semibold name. */
export const AgentRuntimePanelNameFrame = styled(Text, {
  name: 'AgentRuntimePanelName',
  fontWeight: '$semibold',
})

/** `.runtime-panel__tags` — wrapped tag row. */
export const AgentRuntimePanelTagsFrame = styled(View, {
  name: 'AgentRuntimePanelTags',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$1.5',
  marginTop: '$3',
})

/** `.runtime-panel__badge` — 0.625rem badge. */
export const AgentRuntimePanelBadgeFrame = styled(Text, {
  name: 'AgentRuntimePanelBadge',
  fontSize: 10,
})

/** `.runtime-panel__scroll-area` — scrollable padded area. */
export const AgentRuntimePanelScrollAreaFrame = styled(View, {
  name: 'AgentRuntimePanelScrollArea',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  padding: '$4',
})

/** `.runtime-panel__fields-section` — spaced fields section. */
export const AgentRuntimePanelFieldsSectionFrame = styled(View, {
  name: 'AgentRuntimePanelFieldsSection',
  marginBottom: '$6',
})

/** `.runtime-panel__fields-label` — fields label. */
export const AgentRuntimePanelFieldsLabelFrame = styled(Text, {
  name: 'AgentRuntimePanelFieldsLabel',
  marginBottom: '$3',
})

/** `.runtime-panel__field-item` — field row. */
export const AgentRuntimePanelFieldItemFrame = styled(View, {
  name: 'AgentRuntimePanelFieldItem',
  marginBottom: '$4',
})

/** `.runtime-panel__field-header` — flex justify-between. */
export const AgentRuntimePanelFieldHeaderFrame = styled(View, {
  name: 'AgentRuntimePanelFieldHeader',
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '$2',
})

/** `.runtime-panel__field-hint` — field hint. */
export const AgentRuntimePanelFieldHintFrame = styled(Text, {
  name: 'AgentRuntimePanelFieldHint',
  marginTop: '$2',
})

/** `.runtime-panel__tools-toggle` — full-width tools toggle. */
export const AgentRuntimePanelToolsToggleFrame = styled(View, {
  name: 'AgentRuntimePanelToolsToggle',
  width: '100%',
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '$3',
})

/** `.runtime-panel__tool-section-label` — tool section label. */
export const AgentRuntimePanelToolSectionLabelFrame = styled(Text, {
  name: 'AgentRuntimePanelToolSectionLabel',
  marginBottom: '$2',
})

/** `.runtime-panel__tool-info` — growing tool info. */
export const AgentRuntimePanelToolInfoFrame = styled(View, {
  name: 'AgentRuntimePanelToolInfo',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.runtime-panel__tool-package` — block package label. */
export const AgentRuntimePanelToolPackageFrame = styled(Text, {
  name: 'AgentRuntimePanelToolPackage',
  display: 'block',
})

/** `.runtime-panel__empty-state` — centered empty state. */
export const AgentRuntimePanelEmptyStateFrame = styled(View, {
  name: 'AgentRuntimePanelEmptyState',
  textAlign: 'center',
  paddingVertical: '$12',
  paddingHorizontal: 0,
})

/** `.runtime-panel__empty-icon` — 2rem empty icon. */
export const AgentRuntimePanelEmptyIconFrame = styled(Text, {
  name: 'AgentRuntimePanelEmptyIcon',
  fontSize: 32, // 2rem
  marginBottom: '$2',
})

/* ── StructuredOutputDisplay ──────────────────────────────────────── */

/** `.structured-output` — monospace card with scroll. */
export const AgentRuntimeStructuredOutputFrame = styled(View, {
  name: 'AgentRuntimeStructuredOutput',
  fontFamily: 'monospace',
  fontSize: 12, // 0.75rem
  lineHeight: '1.6' as unknown as number, // raw multiplier line-height
  padding: '$3',
  borderRadius: '$radius-md', // 0.375rem
  backgroundColor: '$card',
  borderWidth: 1,
  borderColor: '$border',
  maxHeight: '$96', // 24rem
  overflow: 'auto',
})

/** `.structured-output__null` — muted italic null. */
export const AgentRuntimeStructuredOutputNullFrame = styled(Text, {
  name: 'AgentRuntimeStructuredOutputNull',
  color: '$muted-foreground',
  fontStyle: 'italic',
})

/** `.structured-output__boolean` — agent-colored boolean. */
export const AgentRuntimeStructuredOutputBooleanFrame = styled(Text, {
  name: 'AgentRuntimeStructuredOutputBoolean',
  color: '$agent',
})

/** `.structured-output__number` — warning-colored number. */
export const AgentRuntimeStructuredOutputNumberFrame = styled(Text, {
  name: 'AgentRuntimeStructuredOutputNumber',
  color: '$warning',
})

/** `.structured-output__string` — success-colored string. */
export const AgentRuntimeStructuredOutputStringFrame = styled(Text, {
  name: 'AgentRuntimeStructuredOutputString',
  color: '$success',
})

/** `.structured-output__index` — muted index gutter. */
export const AgentRuntimeStructuredOutputIndexFrame = styled(Text, {
  name: 'AgentRuntimeStructuredOutputIndex',
  color: '$muted-foreground',
  marginRight: '$2',
})

/** `.structured-output__key` — knowledge-colored key. */
export const AgentRuntimeStructuredOutputKeyFrame = styled(Text, {
  name: 'AgentRuntimeStructuredOutputKey',
  color: '$knowledge',
  marginRight: '$2',
})

/** `.structured-output__collapse-btn` — bare collapse button. */
export const AgentRuntimeStructuredOutputCollapseBtnFrame = styled(Text, {
  name: 'AgentRuntimeStructuredOutputCollapseBtn',
  tag: 'button',
  backgroundColor: 'transparent',
  borderWidth: 0,
  cursor: 'pointer',
  color: '$muted-foreground',
  fontSize: 12,
  padding: 0,
})

/* ── ToolCallDisplay ──────────────────────────────────────────────── */

/** `.tool-call-display` — space-y-2 vertical stack (approximated as gap). */
export const AgentRuntimeToolCallDisplayFrame = styled(View, {
  name: 'AgentRuntimeToolCallDisplay',
  gap: '$2', // space-y-2 ≈ vertical gap between children
})

/** `.tool-call-display__text` — pre-wrapped, break-word text. */
export const AgentRuntimeToolCallDisplayTextFrame = styled(Text, {
  name: 'AgentRuntimeToolCallDisplayText',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
})

/* ── JsonSyntax ───────────────────────────────────────────────────── */

/** `.tool-call-display__json-text` — scrollable monospace json blob. */
export const AgentRuntimeToolCallDisplayJsonTextFrame = styled(Text, {
  name: 'AgentRuntimeToolCallDisplayJsonText',
  maxHeight: '$52', // max-h-52 = 208px
  overflow: 'auto',
  borderRadius: '$radius-md',
  padding: '$2.5',
  lineHeight: '1.625' as unknown as number, // leading-relaxed
  fontFamily: 'var(--font-mono)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  backgroundColor: 'color-mix(in srgb, var(--foreground) 80%, transparent)',
  color: '$muted-foreground',
  fontSize: 11,
  scrollbarWidth: 'thin',
})

/** `.tool-call-display__json-tree` — scrollable bordered json tree. */
export const AgentRuntimeToolCallDisplayJsonTreeFrame = styled(View, {
  name: 'AgentRuntimeToolCallDisplayJsonTree',
  maxHeight: '$52',
  overflow: 'auto',
  borderRadius: '$radius-md',
  padding: '$2.5',
  borderWidth: 1,
  borderColor: 'color-mix(in srgb, var(--border) 70%, transparent)',
  backgroundColor: '$background',
  fontSize: 11,
})

/* ── CollapsibleSection ───────────────────────────────────────────── */

/** `.tool-call-display__collapsible` — collapsible wrapper. */
export const AgentRuntimeToolCallDisplayCollapsibleFrame = styled(View, {
  name: 'AgentRuntimeToolCallDisplayCollapsible',
  marginTop: '$1.5',
})

/** `.tool-call-display__collapsible-btn` — full-width toggle button + hover recolor. */
export const AgentRuntimeToolCallDisplayCollapsibleBtnFrame = styled(View, {
  name: 'AgentRuntimeToolCallDisplayCollapsibleBtn',
  tag: 'button',
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  borderRadius: '$radius-md',
  // transition-colors awaits the animation driver (§5/P4)
  gap: '$1.5',
  paddingVertical: '$1',
  paddingHorizontal: '$2',
  fontSize: 11,
  fontWeight: '$medium',
  color: '$muted-foreground',
  hoverStyle: { color: '$foreground', backgroundColor: '$muted' },
})

/** `.tool-call-display__collapsible-icon` — 0.75rem shrink-0 icon. */
export const AgentRuntimeToolCallDisplayCollapsibleIconFrame = styled(View, {
  name: 'AgentRuntimeToolCallDisplayCollapsibleIcon',
  flexShrink: 0,
  width: '$3',
  height: '$3',
})

/** `.tool-call-display__collapsible-dot` — ml-auto dot + args/result color (`--args`/`--result`). */
export const AgentRuntimeToolCallDisplayCollapsibleDotFrame = styled(View, {
  name: 'AgentRuntimeToolCallDisplayCollapsibleDot',
  marginLeft: 'auto',
  borderRadius: '$radius-full',
  width: '$1.5',
  height: '$1.5',

  variants: {
    kind: {
      args: { backgroundColor: '$brand-3' }, // .tool-call-display__collapsible-dot--args
      result: { backgroundColor: '$brand-2' }, // .tool-call-display__collapsible-dot--result
    },
  } as const,
})

/** `.tool-call-display__collapsible-body` — collapsible body. */
export const AgentRuntimeToolCallDisplayCollapsibleBodyFrame = styled(View, {
  name: 'AgentRuntimeToolCallDisplayCollapsibleBody',
  marginTop: '$1',
  // animate-in fade-in awaits the animation driver (§5/P4)
})

/* ── ToolCallCard ─────────────────────────────────────────────────── */

/**
 * `.tool-call-card` — relative overflow-hidden rounded-lg bordered card + hover border + the
 * `.tool-call-card--ring-*` variants (a static ring recolored per tool category).
 */
export const AgentRuntimeToolCallCardFrame = styled(View, {
  name: 'AgentRuntimeToolCallCard',
  position: 'relative',
  overflow: 'hidden',
  borderRadius: '$radius-lg',
  borderWidth: 1,
  // transition-all duration-300 animate-in fade-in await the animation driver (§5/P4)
  borderColor: 'color-mix(in srgb, var(--border) 80%, transparent)',
  backgroundColor: '$card',
  hoverStyle: { borderColor: '$border' },

  variants: {
    // .tool-call-card--ring-* — @apply ring-1 + --tw-ring-color, expressed as an outline ring.
    ring: {
      inspect: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: 'color-mix(in srgb, var(--brand-1) 30%, transparent)' },
      workspace: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: 'color-mix(in srgb, var(--brand-2) 30%, transparent)' },
      agent: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: 'color-mix(in srgb, var(--brand-3) 30%, transparent)' },
      flow: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: 'color-mix(in srgb, var(--brand-2) 30%, transparent)' },
      knowledge: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: 'color-mix(in srgb, var(--brand-4) 30%, transparent)' },
      env: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: 'color-mix(in srgb, var(--brand-1) 30%, transparent)' },
      misc: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: 'color-mix(in srgb, var(--neutral) 30%, transparent)' },
    },
  } as const,
})

/**
 * `.tool-call-card__accent-bar` — absolute top accent bar (opacity 0.8) + the `hovered` variant
 * standing in for the parent-hover descendant rule `.tool-call-card:hover .accent-bar { opacity: 1 }`.
 */
export const AgentRuntimeToolCallCardAccentBarFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardAccentBar',
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  // transition-opacity awaits the animation driver (§5/P4)
  height: 2,
  opacity: 0.8,

  variants: {
    hovered: {
      true: { opacity: 1 }, // parent .tool-call-card:hover raises the bar to full opacity
    },
  } as const,
})

/**
 * `.tool-call-card__gradient--*` — the accent-bar/icon gradient fills. No base selector; expressed as
 * a `gradient` variant enumerating the brand pairings (colors via var(--x), web-passthrough gradient).
 */
export const AgentRuntimeToolCallCardGradientFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardGradient',

  variants: {
    gradient: {
      'brand-1-2': { backgroundImage: 'linear-gradient(to right, var(--brand-1), var(--brand-2))' },
      'brand-1-3': { backgroundImage: 'linear-gradient(to right, var(--brand-1), var(--brand-3))' },
      'brand-2-3': { backgroundImage: 'linear-gradient(to right, var(--brand-2), var(--brand-3))' },
      'brand-2-1': { backgroundImage: 'linear-gradient(to right, var(--brand-2), var(--brand-1))' },
      'brand-3-4': { backgroundImage: 'linear-gradient(to right, var(--brand-3), var(--brand-4))' },
      'brand-2-2': { backgroundImage: 'linear-gradient(to right, var(--brand-2), var(--brand-2))' },
      'brand-4-3': { backgroundImage: 'linear-gradient(to right, var(--brand-4), var(--brand-3))' },
      'brand-4-2': { backgroundImage: 'linear-gradient(to right, var(--brand-4), var(--brand-2))' },
      'brand-4-destructive': { backgroundImage: 'linear-gradient(to right, var(--brand-4), var(--destructive))' },
      neutral: { backgroundImage: 'linear-gradient(to right, var(--neutral), var(--neutral))' },
    },
  } as const,
})

/** `.tool-call-card__header` — flex items-center header. */
export const AgentRuntimeToolCallCardHeaderFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardHeader',
  display: 'flex',
  alignItems: 'center',
  gap: '$2.5', // 0.625rem
  paddingTop: '$3',
  paddingHorizontal: '$3',
  paddingBottom: '$1.5',
})

/**
 * `.tool-call-card__icon` — rounded icon tile with shadow-md + the `.tool-call-card__glow--*` glow
 * (recolors the shadow to `color-mix(var(--brand-N) 20%)`).
 */
export const AgentRuntimeToolCallCardIconFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardIcon',
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$radius-md',
  width: '$7', // 1.75rem
  height: '$7',
  color: '$primary-foreground',
  // shadow-md ≈ opaque-black-with-alpha, offset y4, radius 6
  shadowColor: 'rgba(0,0,0,0.1)',
  shadowOffset: { width: 0, height: 4 },
  shadowRadius: 6,

  variants: {
    // .tool-call-card__glow--* — recolor the shadow to a brand glow.
    glow: {
      'brand-1': { shadowColor: 'color-mix(in srgb, var(--brand-1) 20%, transparent)' },
      'brand-2': { shadowColor: 'color-mix(in srgb, var(--brand-2) 20%, transparent)' },
      'brand-3': { shadowColor: 'color-mix(in srgb, var(--brand-3) 20%, transparent)' },
      'brand-4': { shadowColor: 'color-mix(in srgb, var(--brand-4) 20%, transparent)' },
      neutral: { shadowColor: 'color-mix(in srgb, var(--neutral) 20%, transparent)' },
    },
  } as const,
})

/** `.tool-call-card__icon-inner` — 0.875rem inner glyph. */
export const AgentRuntimeToolCallCardIconInnerFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardIconInner',
  width: '$3.5', // 0.875rem
  height: '$3.5',
})

/** `.tool-call-card__info` — min-w-0 flex-1 info column. */
export const AgentRuntimeToolCallCardInfoFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardInfo',
  minWidth: 0,
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
})

/** `.tool-call-card__title-row` — flex items-center title row. */
export const AgentRuntimeToolCallCardTitleRowFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardTitleRow',
  display: 'flex',
  alignItems: 'center',
  gap: '$2',
})

/** `.tool-call-card__label` — truncated bold label. */
export const AgentRuntimeToolCallCardLabelFrame = styled(Text, {
  name: 'AgentRuntimeToolCallCardLabel',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  fontWeight: '$semibold',
  color: '$foreground',
})

/** `.tool-call-card__counter` — pill counter. */
export const AgentRuntimeToolCallCardCounterFrame = styled(Text, {
  name: 'AgentRuntimeToolCallCardCounter',
  flexShrink: 0,
  borderRadius: '$radius-full',
  backgroundColor: '$muted',
  paddingVertical: 1,
  paddingHorizontal: '$1.5',
  fontSize: 10,
  fontWeight: '$medium',
  color: '$muted-foreground',
})

/** `.tool-call-card__name` — monospace tool name. */
export const AgentRuntimeToolCallCardNameFrame = styled(Text, {
  name: 'AgentRuntimeToolCallCardName',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  color: '$muted-foreground',
})

/** `.tool-call-card__status` — shrink-0 status slot. */
export const AgentRuntimeToolCallCardStatusFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardStatus',
  flexShrink: 0,
})

/** `.tool-call-card__status-badge` — pill status badge + ok/err surface (`--ok`/`--err`). */
export const AgentRuntimeToolCallCardStatusBadgeFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardStatusBadge',
  display: 'flex',
  alignItems: 'center',
  borderRadius: '$radius-full',
  gap: '$1',
  paddingVertical: '$0.5',
  paddingHorizontal: '$2',

  variants: {
    state: {
      ok: { backgroundColor: 'color-mix(in srgb, var(--brand-2) 10%, transparent)' },
      err: { backgroundColor: 'color-mix(in srgb, var(--brand-4) 10%, transparent)' },
    },
  } as const,
})

/** `.tool-call-card__status-icon` — 0.75rem status icon + ok/err color (`--ok`/`--err`). */
export const AgentRuntimeToolCallCardStatusIconFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardStatusIcon',
  width: '$3',
  height: '$3',

  variants: {
    state: {
      ok: { color: '$brand-2' },
      err: { color: '$brand-4' },
    },
  } as const,
})

/** `.tool-call-card__status-text` — status text + ok/err color (`--ok`/`--err`). */
export const AgentRuntimeToolCallCardStatusTextFrame = styled(Text, {
  name: 'AgentRuntimeToolCallCardStatusText',
  fontSize: 10,
  fontWeight: '$semibold',

  variants: {
    state: {
      ok: { color: '$brand-2' },
      err: { color: '$brand-4' },
    },
  } as const,
})

/** `.tool-call-card__body` — card body padding. */
export const AgentRuntimeToolCallCardBodyFrame = styled(View, {
  name: 'AgentRuntimeToolCallCardBody',
  paddingTop: 0,
  paddingHorizontal: '$3',
  paddingBottom: '$2.5',
})

/* ── ToolRunningPill ──────────────────────────────────────────────── */

/** `.tool-running-pill` — inline gradient pill. */
export const AgentRuntimeRunningPillFrame = styled(View, {
  name: 'AgentRuntimeRunningPill',
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '$radius-full',
  borderWidth: 1,
  borderColor: '$border',
  backgroundImage: 'linear-gradient(to right, var(--muted), var(--muted))',
  gap: '$2',
  paddingVertical: '$1.5',
  paddingHorizontal: '$3',
})

/** `.tool-running-pill__dots` — flex dot row. */
export const AgentRuntimeRunningPillDotsFrame = styled(View, {
  name: 'AgentRuntimeRunningPillDots',
  display: 'flex',
  gap: '$0.5',
})

/**
 * `.tool-running-pill__dot` — bouncing dot. animate-bounce + the `:nth-child` animation-delay
 * staggers await the animation driver (§5/P4).
 */
export const AgentRuntimeRunningPillDotFrame = styled(View, {
  name: 'AgentRuntimeRunningPillDot',
  // animate-bounce (+ nth-child 150ms/300ms delays) await the animation driver (§5/P4)
  borderRadius: '$radius-full',
  width: '$1.5',
  height: '$1.5',
  backgroundColor: '$brand-3',
})

/** `.tool-running-pill__text` — pill text. */
export const AgentRuntimeRunningPillTextFrame = styled(Text, {
  name: 'AgentRuntimeRunningPillText',
  fontSize: 11,
  fontWeight: '$medium',
  color: '$muted-foreground',
})

/** `.tool-running-pill__list` — wrapped item list. */
export const AgentRuntimeRunningPillListFrame = styled(View, {
  name: 'AgentRuntimeRunningPillList',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '$1.5',
})

/** `.tool-running-pill__item` — bordered ring-1 pill item. */
export const AgentRuntimeRunningPillItemFrame = styled(View, {
  name: 'AgentRuntimeRunningPillItem',
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '$radius-full',
  borderWidth: 1,
  // ring-1 — default-ring outline
  outlineWidth: 1,
  outlineStyle: 'solid',
  outlineColor: '$ring',
  gap: '$1.5',
  paddingVertical: '$1',
  paddingHorizontal: '$2.5',
  borderColor: 'color-mix(in srgb, var(--border) 80%, transparent)',
  backgroundColor: '$card',
})

/** `.tool-running-pill__item-icon` — round item icon. */
export const AgentRuntimeRunningPillItemIconFrame = styled(View, {
  name: 'AgentRuntimeRunningPillItemIcon',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '$radius-full',
  width: '$4',
  height: '$4',
  color: '$primary-foreground',
})

/** `.tool-running-pill__item-label` — item label. */
export const AgentRuntimeRunningPillItemLabelFrame = styled(Text, {
  name: 'AgentRuntimeRunningPillItemLabel',
  fontSize: 11,
  fontWeight: '$medium',
  color: '$foreground',
})

/** `.tool-running-pill__item-dots` — item dot row. */
export const AgentRuntimeRunningPillItemDotsFrame = styled(View, {
  name: 'AgentRuntimeRunningPillItemDots',
  display: 'flex',
  gap: '$0.5',
})

/** `.tool-running-pill__item-dot` — bouncing item dot. */
export const AgentRuntimeRunningPillItemDotFrame = styled(View, {
  name: 'AgentRuntimeRunningPillItemDot',
  // animate-bounce (+ nth-child 150ms/300ms delays) await the animation driver (§5/P4)
  borderRadius: '$radius-full',
  width: '$1',
  height: '$1',
  backgroundColor: '$neutral',
})

/* ── ConversationSidebar ──────────────────────────────────────────── */

/** `.conversation-sidebar` — 16rem right-bordered rail. */
export const AgentRuntimeConversationSidebarFrame = styled(View, {
  name: 'AgentRuntimeConversationSidebar',
  width: '$64', // 16rem = 256px = $64
  flexShrink: 0,
  borderRightWidth: 1,
  borderRightColor: '$border',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
})

/** `.conversation-sidebar__panel` — full-height column. */
export const AgentRuntimeConversationSidebarPanelFrame = styled(View, {
  name: 'AgentRuntimeConversationSidebarPanel',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
})

/** `.conversation-sidebar__header-row` — flex items-center justify-between. */
export const AgentRuntimeConversationSidebarHeaderRowFrame = styled(View, {
  name: 'AgentRuntimeConversationSidebarHeaderRow',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
})

/** `.conversation-sidebar__header-label` — 0.8125rem label. */
export const AgentRuntimeConversationSidebarHeaderLabelFrame = styled(Text, {
  name: 'AgentRuntimeConversationSidebarHeaderLabel',
  fontSize: 13,
})

/** `.conversation-sidebar__body` — scrollable body. */
export const AgentRuntimeConversationSidebarBodyFrame = styled(View, {
  name: 'AgentRuntimeConversationSidebarBody',
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: '0%',
  overflowY: 'auto',
  padding: 0,
})

/** `.conversation-sidebar__list` — unstyled list. */
export const AgentRuntimeConversationSidebarListFrame = styled(View, {
  name: 'AgentRuntimeConversationSidebarList',
  tag: 'ul',
  listStyleType: 'none',
  margin: 0,
  padding: 0,
})

/**
 * `.conversation-sidebar__item` — bordered list button + hover + the `active` variant
 * (`--active`: muted surface, brand-3 left border, compensated padding).
 */
export const AgentRuntimeConversationSidebarItemFrame = styled(View, {
  name: 'AgentRuntimeConversationSidebarItem',
  tag: 'button',
  display: 'block',
  width: '100%',
  textAlign: 'left',
  borderWidth: 0,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  paddingVertical: '$2.5', // 0.625rem
  paddingHorizontal: '$4',
  borderBottomWidth: 1,
  borderBottomColor: '$border',
  // transition: background-color awaits the animation driver (§5/P4)
  color: 'inherit',
  // font: inherit — not expressible as a single prop
  hoverStyle: { backgroundColor: '$muted' },

  variants: {
    active: {
      true: {
        backgroundColor: '$muted',
        borderLeftWidth: 2,
        borderLeftColor: '$brand-3',
        paddingLeft: 'calc(1rem - 2px)',
      },
    },
  } as const,
})

/** `.conversation-sidebar__item-title` — truncated item title. */
export const AgentRuntimeConversationSidebarItemTitleFrame = styled(Text, {
  name: 'AgentRuntimeConversationSidebarItemTitle',
  fontSize: 13,
  fontWeight: '$medium',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

/** `.conversation-sidebar__item-meta` — flex items-center justify-between meta row. */
export const AgentRuntimeConversationSidebarItemMetaFrame = styled(View, {
  name: 'AgentRuntimeConversationSidebarItemMeta',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: '$1',
})

/** `.conversation-sidebar__empty` — centered empty message. */
export const AgentRuntimeConversationSidebarEmptyFrame = styled(View, {
  name: 'AgentRuntimeConversationSidebarEmpty',
  paddingVertical: '$6',
  paddingHorizontal: '$4',
  textAlign: 'center',
})

/* ── Styled wrappers (representative top-level frames) ─────────────── */

export type AgentRuntimeToolCallCardRing =
  | 'inspect' | 'workspace' | 'agent' | 'flow' | 'knowledge' | 'env' | 'misc'
export type AgentRuntimeOkErr = 'ok' | 'err'

export interface StyledAgentRuntimeToolCallCardProps extends React.ComponentProps<'div'> {
  ring?: AgentRuntimeToolCallCardRing
}
export interface StyledAgentRuntimeConversationSidebarItemProps extends React.ComponentProps<'button'> {
  active?: boolean
}
export interface StyledAgentRuntimeFieldsToggleProps extends React.ComponentProps<'button'> {
  state?: 'on' | 'off'
}

// SPIKE-C casts (react18/19 dual-types); variant props surfaced via the *Props interfaces above.
const CardFrame = AgentRuntimeToolCallCardFrame as unknown as React.ComponentType<any>
const PanelFrame = AgentRuntimePanelFrame as unknown as React.ComponentType<any>
const SidebarFrame = AgentRuntimeConversationSidebarFrame as unknown as React.ComponentType<any>
const SidebarItemFrame = AgentRuntimeConversationSidebarItemFrame as unknown as React.ComponentType<any>
const FieldsFrame = AgentRuntimeFieldsFrame as unknown as React.ComponentType<any>
const ToggleFrame = AgentRuntimeFieldsToggleFrame as unknown as React.ComponentType<any>
const RunningPillFrame = AgentRuntimeRunningPillFrame as unknown as React.ComponentType<any>
const CardBase = AgentRuntimeCardFrame as unknown as React.ComponentType<any>

/** Idiomatic ToolCallCard — carries the `ring` category variant. */
export function StyledAgentRuntimeToolCallCard({ ring, ...props }: StyledAgentRuntimeToolCallCardProps) {
  return <CardFrame ring={ring} {...props} />
}
/** Idiomatic AssistantCard body. */
export function StyledAgentRuntimeCard(props: React.ComponentProps<'div'>) {
  return <CardBase {...props} />
}
/** Idiomatic RuntimePanel column. */
export function StyledAgentRuntimePanel(props: React.ComponentProps<'div'>) {
  return <PanelFrame {...props} />
}
/** Idiomatic RuntimeFieldsSidebar rail. */
export function StyledAgentRuntimeFields(props: React.ComponentProps<'div'>) {
  return <FieldsFrame {...props} />
}
/** Idiomatic ToggleSwitch track — `state` = on|off. */
export function StyledAgentRuntimeFieldsToggle({ state, ...props }: StyledAgentRuntimeFieldsToggleProps) {
  return <ToggleFrame state={state} {...props} />
}
/** Idiomatic ToolRunningPill. */
export function StyledAgentRuntimeRunningPill(props: React.ComponentProps<'div'>) {
  return <RunningPillFrame {...props} />
}
/** Idiomatic ConversationSidebar rail. */
export function StyledAgentRuntimeConversationSidebar(props: React.ComponentProps<'div'>) {
  return <SidebarFrame {...props} />
}
/** Idiomatic ConversationSidebar item — carries the `active` variant. */
export function StyledAgentRuntimeConversationSidebarItem({ active, ...props }: StyledAgentRuntimeConversationSidebarItemProps) {
  return <SidebarItemFrame active={active} {...props} />
}
