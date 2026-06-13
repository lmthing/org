/**
 * Browser-safe UI entry: the design-system catalog + cross-platform form
 * normalization, with NO Node dependencies. Exposed as `@repl/core/ui` so the
 * web bundle can import these helpers without dragging in the Node-only runtime
 * (sandbox, session, child_process, …) from the main barrel.
 */
export {
  CATALOG, DISPLAY_CATALOG, FORM_CATALOG, CATALOG_BY_NAME, CATALOG_NAMES,
  isFormComponent, catalogDts, catalogSummary,
} from './catalog.js';
export type { CatalogEntry, CatalogProp } from './catalog.js';
export {
  flattenForm, normalizeOptions, coerceValue, defaultFor, isFormDescriptor, isCatalogForm,
} from './form.js';
export type { FieldSpec, FieldKind, FormSpec, Option } from './form.js';
