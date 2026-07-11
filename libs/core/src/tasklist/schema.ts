/**
 * Check a single field's value against a declared type. Returns an error
 * string describing the problem, or `undefined` when the value is fine.
 */
function checkField(field: string, type: string, obj: Record<string, unknown>): string | undefined {
  // A trailing `?` marks the field optional: absent (or explicitly `undefined`)
  // is fine; a present non-undefined value is checked against the base type.
  const optional = type.endsWith('?');
  const base = optional ? type.slice(0, -1) : type;
  if (!(field in obj) || obj[field] === undefined) {
    return optional ? undefined : `missing required field "${field}" (expected ${type})`;
  }

  const fieldValue = obj[field];

  switch (base) {
    case 'string':
      if (typeof fieldValue !== 'string') return `field "${field}" must be a string (got ${describe(fieldValue)})`;
      break;
    case 'number':
      if (typeof fieldValue !== 'number') return `field "${field}" must be a number (got ${describe(fieldValue)})`;
      break;
    case 'boolean':
      if (typeof fieldValue !== 'boolean') return `field "${field}" must be a boolean (got ${describe(fieldValue)})`;
      break;
    case 'object':
      if (typeof fieldValue !== 'object' || fieldValue === null || Array.isArray(fieldValue))
        return `field "${field}" must be an object (got ${describe(fieldValue)})`;
      break;
    case 'array':
      if (!Array.isArray(fieldValue)) return `field "${field}" must be an array (got ${describe(fieldValue)})`;
      break;
    case 'any':
      // Accept any non-undefined value
      if (fieldValue === undefined) return `field "${field}" is required (got undefined)`;
      break;
    default:
      // Unknown type — be lenient
      break;
  }
  return undefined;
}

function describe(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Validate `seed` against a tasklist's declared `input` schema (from
 * tasklists/<name>/index.md frontmatter). Returns a list of human-readable
 * error strings naming the missing/mistyped fields; empty when valid.
 * Schema: { field: "string"|"number"|"boolean"|"object"|"array"|"any" }
 */
export function validateInput(input: Record<string, string>, value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [`expected an object with fields: ${Object.keys(input).join(', ')} (got ${describe(value)})`];
  }

  const obj = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const [field, type] of Object.entries(input)) {
    const err = checkField(field, type, obj);
    if (err) errors.push(err);
  }
  return errors;
}

/**
 * Validate that value matches the output schema.
 * Schema: { field: "string"|"number"|"boolean"|"object"|"array" }
 */
export function validateOutput(output: Record<string, string>, value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  for (const [field, type] of Object.entries(output)) {
    // A trailing `?` marks the field optional (absent / `undefined` is allowed).
    const optional = type.endsWith('?');
    const base = optional ? type.slice(0, -1) : type;
    if (!(field in obj) || obj[field] === undefined) {
      if (optional) continue;
      return false;
    }

    const fieldValue = obj[field];

    switch (base) {
      case 'string':
        if (typeof fieldValue !== 'string') return false;
        break;
      case 'number':
        if (typeof fieldValue !== 'number') return false;
        break;
      case 'boolean':
        if (typeof fieldValue !== 'boolean') return false;
        break;
      case 'object':
        if (typeof fieldValue !== 'object' || fieldValue === null || Array.isArray(fieldValue))
          return false;
        break;
      case 'array':
        if (!Array.isArray(fieldValue)) return false;
        break;
      case 'any':
        // Accept any non-undefined value
        if (fieldValue === undefined) return false;
        break;
      default:
        // Unknown type — be lenient
        break;
    }
  }

  return true;
}
