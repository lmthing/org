// src/catalog/json.ts
function queryPath(data, path) {
  const parts = path.replace(/^\$\.?/, "").split(".").filter(Boolean);
  let current = data;
  for (const part of parts) {
    if (current == null) return void 0;
    const arrayMatch = part.match(/^(\w+)\[(\*|\d+)\]$/);
    if (arrayMatch) {
      const [, key, index] = arrayMatch;
      current = current[key];
      if (!Array.isArray(current)) return void 0;
      if (index === "*") return current;
      current = current[parseInt(index, 10)];
    } else {
      current = current[part];
    }
  }
  return current;
}
function deepMerge(...objects) {
  const result = {};
  for (const obj of objects) {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "object" && value !== null && !Array.isArray(value) && typeof result[key] === "object" && result[key] !== null && !Array.isArray(result[key])) {
          result[key] = deepMerge(result[key], value);
        } else {
          result[key] = value;
        }
      }
    }
  }
  return result;
}
function diff(a, b, path = "$") {
  const diffs = [];
  if (a === b) return diffs;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    diffs.push({ path, type: "changed", oldValue: a, newValue: b });
    return diffs;
  }
  const aObj = a;
  const bObj = b;
  const allKeys = /* @__PURE__ */ new Set([...Object.keys(aObj), ...Object.keys(bObj)]);
  for (const key of allKeys) {
    if (!(key in aObj)) {
      diffs.push({ path: `${path}.${key}`, type: "added", newValue: bObj[key] });
    } else if (!(key in bObj)) {
      diffs.push({ path: `${path}.${key}`, type: "removed", oldValue: aObj[key] });
    } else {
      diffs.push(...diff(aObj[key], bObj[key], `${path}.${key}`));
    }
  }
  return diffs;
}
var jsonModule = {
  id: "json",
  description: "JSON manipulation utilities",
  functions: [
    {
      name: "jsonParse",
      description: "Parse JSON with better error messages",
      signature: "(text: string) => any",
      fn: (text) => {
        try {
          return JSON.parse(text);
        } catch (e) {
          const err = e;
          throw new Error(`JSON parse error: ${err.message}`);
        }
      }
    },
    {
      name: "jsonQuery",
      description: "JSONPath query",
      signature: "(data: any, path: string) => any",
      fn: (data, path) => queryPath(data, path)
    },
    {
      name: "jsonTransform",
      description: "Map over arrays/objects",
      signature: "(data: any, fn: (item: any) => any) => any",
      fn: (data, fn) => {
        const mapper = fn;
        if (Array.isArray(data)) return data.map(mapper);
        if (typeof data === "object" && data !== null) {
          const result = {};
          for (const [k, v] of Object.entries(data)) {
            result[k] = mapper(v);
          }
          return result;
        }
        return mapper(data);
      }
    },
    {
      name: "jsonMerge",
      description: "Deep merge objects",
      signature: "(...objects: any[]) => any",
      fn: (...objects) => deepMerge(...objects)
    },
    {
      name: "jsonDiff",
      description: "Structural diff between two objects",
      signature: "(a: any, b: any) => Diff[]",
      fn: (a, b) => diff(a, b)
    }
  ]
};
var json_default = jsonModule;
export {
  json_default as default
};
