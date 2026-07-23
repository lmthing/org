/**
 * The audited computed-style property set (Layer 2, §3). getComputedStyle for exactly these
 * properties is compared string-for-string between the passthrough baseline and the Tamagui
 * candidate for every element in every fixture. This is where a `div`→flex box-model regression
 * (display:flex, flex-shrink:0, align-items:stretch, box-sizing) is caught deterministically.
 *
 * Shared by the in-page extractor and the spec so the list can never drift between capture and
 * assertion. See docs/react-native-tamagui-migration.md §3 Layer 2.
 */
export const AUDITED_PROPERTIES = [
  // box model
  'display',
  'position',
  'box-sizing',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  // flex
  'flex-direction',
  'flex-wrap',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'align-items',
  'align-self',
  'justify-content',
  'gap',
  'row-gap',
  'column-gap',
  // paint / type
  'color',
  'background-color',
  'border-top-color',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'box-shadow',
  'overflow-x',
  'overflow-y',
  'z-index',
] as const

export type AuditedProperty = (typeof AUDITED_PROPERTIES)[number]
