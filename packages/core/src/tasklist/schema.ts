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
    if (!(field in obj)) return false;

    const fieldValue = obj[field];

    switch (type) {
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
      default:
        // Unknown type — be lenient
        break;
    }
  }

  return true;
}
