// `SettingsSchemaForm` moved to `elements/forms/settings-schema-form` — chat renders it too, and
// while it lived here it was the one import pulling the studio surface into chat's module graph
// (docs/mobile-native-chat.md). Re-exported so studio's existing import path keeps working.
export { SettingsSchemaForm } from '../../elements/forms/settings-schema-form'
export type {
  SettingsSchemaFormProps,
  JsonSchema,
  JsonSchemaProperty,
} from '../../elements/forms/settings-schema-form'
