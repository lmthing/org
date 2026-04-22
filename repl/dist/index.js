import {
  createReadLedger,
  hasBeenRead,
  recordRead
} from "./chunk-T4FGEGHD.js";
import {
  isFileWatchingSupported,
  watchSpaces
} from "./chunk-QGC6VYHK.js";
import {
  FocusController,
  SystemPromptBuilder,
  buildSystemPromptFromConfig
} from "./chunk-NBVGJW45.js";

// src/session/session.ts
import { EventEmitter } from "events";

// src/session/config.ts
import { z } from "zod";
var DEFAULT_CONFIG = {
  functionTimeout: 3e4,
  askTimeout: 3e5,
  sessionTimeout: 6e5,
  maxStopCalls: 50,
  maxAsyncTasks: 10,
  maxTasklistReminders: 3,
  maxTaskRetries: 3,
  maxTasksPerTasklist: 20,
  taskAsyncTimeout: 6e4,
  sleepMaxSeconds: 30,
  maxContextTokens: 1e5,
  serializationLimits: {
    maxStringLength: 2e3,
    maxArrayElements: 50,
    maxObjectKeys: 20,
    maxDepth: 5
  },
  workspace: {
    maxScopeVariables: 50,
    maxScopeValueWidth: 50,
    maxScopeTokens: 3e3
  },
  contextWindow: {
    codeWindowLines: 200,
    stopDecayTiers: {
      full: 2,
      keysOnly: 5,
      summary: 10
    },
    neverTruncateInterventions: true
  }
};
function createDefaultConfig() {
  return structuredClone(DEFAULT_CONFIG);
}
var sessionConfigSchema = z.object({
  functionTimeout: z.number().positive().optional(),
  askTimeout: z.number().positive().optional(),
  sessionTimeout: z.number().positive().optional(),
  maxStopCalls: z.number().int().positive().optional(),
  maxAsyncTasks: z.number().int().positive().optional(),
  maxTasklistReminders: z.number().int().positive().optional(),
  maxTaskRetries: z.number().int().positive().optional(),
  maxTasksPerTasklist: z.number().int().positive().optional(),
  taskAsyncTimeout: z.number().int().positive().optional(),
  sleepMaxSeconds: z.number().int().positive().optional(),
  maxContextTokens: z.number().int().positive().optional(),
  serializationLimits: z.object({
    maxStringLength: z.number().int().positive().optional(),
    maxArrayElements: z.number().int().positive().optional(),
    maxObjectKeys: z.number().int().positive().optional(),
    maxDepth: z.number().int().positive().optional()
  }).optional(),
  workspace: z.object({
    maxScopeVariables: z.number().int().positive().optional(),
    maxScopeValueWidth: z.number().int().positive().optional(),
    maxScopeTokens: z.number().int().positive().optional()
  }).optional(),
  contextWindow: z.object({
    codeWindowLines: z.number().int().positive().optional(),
    stopDecayTiers: z.object({
      full: z.number().int().nonnegative().optional(),
      keysOnly: z.number().int().nonnegative().optional(),
      summary: z.number().int().nonnegative().optional()
    }).optional(),
    neverTruncateInterventions: z.boolean().optional()
  }).optional()
});
function validateConfig(input) {
  const result = sessionConfigSchema.safeParse(input);
  if (result.success) {
    return { valid: true, config: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
  };
}
function mergeConfig(overrides) {
  const base = createDefaultConfig();
  return {
    functionTimeout: overrides.functionTimeout ?? base.functionTimeout,
    askTimeout: overrides.askTimeout ?? base.askTimeout,
    sessionTimeout: overrides.sessionTimeout ?? base.sessionTimeout,
    maxStopCalls: overrides.maxStopCalls ?? base.maxStopCalls,
    maxAsyncTasks: overrides.maxAsyncTasks ?? base.maxAsyncTasks,
    maxTasklistReminders: overrides.maxTasklistReminders ?? base.maxTasklistReminders,
    maxTaskRetries: overrides.maxTaskRetries ?? base.maxTaskRetries,
    maxTasksPerTasklist: overrides.maxTasksPerTasklist ?? base.maxTasksPerTasklist,
    taskAsyncTimeout: overrides.taskAsyncTimeout ?? base.taskAsyncTimeout,
    sleepMaxSeconds: overrides.sleepMaxSeconds ?? base.sleepMaxSeconds,
    maxContextTokens: overrides.maxContextTokens ?? base.maxContextTokens,
    serializationLimits: {
      maxStringLength: overrides.serializationLimits?.maxStringLength ?? base.serializationLimits.maxStringLength,
      maxArrayElements: overrides.serializationLimits?.maxArrayElements ?? base.serializationLimits.maxArrayElements,
      maxObjectKeys: overrides.serializationLimits?.maxObjectKeys ?? base.serializationLimits.maxObjectKeys,
      maxDepth: overrides.serializationLimits?.maxDepth ?? base.serializationLimits.maxDepth
    },
    workspace: {
      maxScopeVariables: overrides.workspace?.maxScopeVariables ?? base.workspace.maxScopeVariables,
      maxScopeValueWidth: overrides.workspace?.maxScopeValueWidth ?? base.workspace.maxScopeValueWidth,
      maxScopeTokens: overrides.workspace?.maxScopeTokens ?? base.workspace.maxScopeTokens
    },
    contextWindow: {
      codeWindowLines: overrides.contextWindow?.codeWindowLines ?? base.contextWindow.codeWindowLines,
      stopDecayTiers: {
        full: overrides.contextWindow?.stopDecayTiers?.full ?? base.contextWindow.stopDecayTiers.full,
        keysOnly: overrides.contextWindow?.stopDecayTiers?.keysOnly ?? base.contextWindow.stopDecayTiers.keysOnly,
        summary: overrides.contextWindow?.stopDecayTiers?.summary ?? base.contextWindow.stopDecayTiers.summary
      },
      neverTruncateInterventions: overrides.contextWindow?.neverTruncateInterventions ?? base.contextWindow.neverTruncateInterventions
    }
  };
}

// src/sandbox/vector-index.ts
var DEFAULT_STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "if",
  "in",
  "into",
  "is",
  "it",
  "no",
  "not",
  "of",
  "on",
  "or",
  "such",
  "that",
  "the",
  "their",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "will",
  "with",
  "const",
  "let",
  "var",
  "function",
  "return",
  "await",
  "async",
  "import",
  "export",
  "from",
  "class",
  "interface",
  "type"
]);
var VectorIndex = class {
  documents = [];
  idf = /* @__PURE__ */ new Map();
  options;
  constructor(options = {}) {
    this.options = {
      maxDocuments: options.maxDocuments ?? 1e3,
      minTermLength: options.minTermLength ?? 2,
      stopWords: options.stopWords ?? DEFAULT_STOP_WORDS
    };
  }
  /**
   * Tokenize text into terms, filtering stop words and short terms.
   */
  tokenize(text) {
    const tokens = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length >= this.options.minTermLength).filter((t) => !this.options.stopWords.has(t));
    return [...new Set(tokens)];
  }
  /**
   * Compute TF-IDF score for a term in a document.
   */
  tfIdf(term, docTerms) {
    const tf = docTerms.filter((t) => t === term).length;
    const df = this.documents.filter((d) => d.terms.includes(term)).length + 1;
    const idf = Math.log((this.documents.length + 1) / df);
    return tf * idf;
  }
  /**
   * Compute cosine similarity between two term vectors.
   */
  cosineSimilarity(termsA, termsB) {
    const uniqueTerms = /* @__PURE__ */ new Set([...termsA, ...termsB]);
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (const term of uniqueTerms) {
      const tfA = termsA.filter((t) => t === term).length;
      const tfB = termsB.filter((t) => t === term).length;
      dotProduct += tfA * tfB;
      normA += tfA * tfA;
      normB += tfB * tfB;
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }
  /**
   * Index a document (text + code) for a given turn.
   * Extracts comments from code for semantic indexing.
   */
  index(text, code, turn) {
    const combined = `${text} ${this.extractComments(code)}`;
    const terms = this.tokenize(combined);
    this.documents.push({ turn, text, code, terms });
    if (this.documents.length > this.options.maxDocuments) {
      this.documents.shift();
    }
    this.recomputeIdf();
  }
  /**
   * Extract comments from code (single-line and multi-line).
   */
  extractComments(code) {
    const comments = [];
    for (const line of code.split("\n")) {
      const singleMatch = line.match(/\/\/(.*)$/);
      if (singleMatch) {
        comments.push(singleMatch[1].trim());
      }
    }
    const multiMatch = code.match(/\/\*([\s\S]*?)\*\//g);
    if (multiMatch) {
      for (const match of multiMatch) {
        const content = match.slice(2, -2).trim();
        comments.push(content);
      }
    }
    return comments.join(" ");
  }
  /**
   * Recompute IDF scores for all terms.
   */
  recomputeIdf() {
    this.idf.clear();
    const totalDocs = this.documents.length;
    const allTerms = /* @__PURE__ */ new Set();
    for (const doc of this.documents) {
      for (const term of doc.terms) {
        allTerms.add(term);
      }
    }
    for (const term of allTerms) {
      const df = this.documents.filter((d) => d.terms.includes(term)).length;
      this.idf.set(term, Math.log(totalDocs / df));
    }
  }
  /**
   * Search for similar documents using TF-IDF cosine similarity.
   */
  search(query, topK = 5) {
    const queryTerms = this.tokenize(query);
    const results = [];
    for (const doc of this.documents) {
      const score = this.cosineSimilarity(queryTerms, doc.terms);
      if (score > 0) {
        results.push({
          turn: doc.turn,
          score,
          text: doc.text,
          code: doc.code
        });
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }
  /**
   * Get number of indexed documents.
   */
  get size() {
    return this.documents.length;
  }
  /**
   * Clear all indexed documents.
   */
  clear() {
    this.documents = [];
    this.idf.clear();
  }
};

// src/sandbox/sandbox.ts
import vm2 from "vm";
import React from "react";

// src/sandbox/executor.ts
import vm from "vm";

// src/sandbox/transpiler.ts
import ts from "typescript";
var compilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  jsx: ts.JsxEmit.React,
  jsxFactory: "React.createElement",
  jsxFragmentFactory: "React.Fragment",
  strict: false,
  esModuleInterop: true
};
function transpile(code) {
  const result = ts.transpileModule(code, { compilerOptions });
  return result.outputText;
}

// src/parser/ast-utils.ts
import ts2 from "typescript";
function parseStatement(source) {
  const sourceFile = ts2.createSourceFile(
    "line.ts",
    source,
    ts2.ScriptTarget.ESNext,
    true,
    ts2.ScriptKind.TSX
  );
  const statements = sourceFile.statements;
  if (statements.length === 0) return null;
  return statements[0];
}
function extractDeclarations(source) {
  const node = parseStatement(source);
  if (!node) return [];
  const names = [];
  if (ts2.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      extractBindingNames(decl.name, names);
    }
  } else if (ts2.isFunctionDeclaration(node) && node.name) {
    names.push(node.name.text);
  } else if (ts2.isClassDeclaration(node) && node.name) {
    names.push(node.name.text);
  }
  return names;
}
function extractBindingNames(node, names) {
  if (ts2.isIdentifier(node)) {
    names.push(node.text);
  } else if (ts2.isObjectBindingPattern(node)) {
    for (const element of node.elements) {
      extractBindingNames(element.name, names);
    }
  } else if (ts2.isArrayBindingPattern(node)) {
    for (const element of node.elements) {
      if (ts2.isBindingElement(element)) {
        extractBindingNames(element.name, names);
      }
    }
  }
}
function recoverArgumentNames(source) {
  const sourceFile = ts2.createSourceFile(
    "line.ts",
    source,
    ts2.ScriptTarget.ESNext,
    true,
    ts2.ScriptKind.TSX
  );
  let callExpr = null;
  function visit(node) {
    if (callExpr) return;
    if (ts2.isCallExpression(node)) {
      const callee = node.expression;
      if (ts2.isIdentifier(callee)) {
        const name = callee.text;
        if (name === "stop" || name === "display" || name === "ask" || name === "async") {
          callExpr = node;
          return;
        }
      }
    }
    ts2.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!callExpr) return [];
  return callExpr.arguments.map((arg, i) => {
    if (ts2.isIdentifier(arg)) {
      return arg.text;
    }
    if (ts2.isPropertyAccessExpression(arg)) {
      return arg.getText(sourceFile);
    }
    if (ts2.isElementAccessExpression(arg)) {
      return arg.getText(sourceFile);
    }
    return `arg_${i}`;
  });
}
function extractVariableNames(source) {
  const sourceFile = ts2.createSourceFile(
    "line.ts",
    source,
    ts2.ScriptTarget.ESNext,
    true,
    ts2.ScriptKind.TSX
  );
  const names = /* @__PURE__ */ new Set();
  function visit(node) {
    if (ts2.isIdentifier(node)) {
      const parent = node.parent;
      if (parent && ts2.isPropertyAccessExpression(parent) && parent.name === node) {
      } else {
        names.add(node.text);
      }
    }
    ts2.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...names];
}

// src/sandbox/executor.ts
async function executeLine(code, lineNumber, context, timeout = 3e4) {
  try {
    const js = transpile(code);
    const trimmedJs = js.trim();
    if (trimmedJs === "") {
      return { ok: true, result: void 0 };
    }
    const hasAwait = trimmedJs.includes("await ");
    if (hasAwait) {
      const declaredNames = extractDeclarations(code);
      const assignments = declaredNames.map((name) => `globalThis[${JSON.stringify(name)}] = typeof ${name} !== 'undefined' ? ${name} : undefined;`).join("\n");
      const wrapped = `(async () => {
${trimmedJs}
${assignments}
})()`;
      const script = new vm.Script(wrapped, { filename: `line-${lineNumber}.js` });
      const result = await script.runInContext(context, { timeout });
      return { ok: true, result };
    } else {
      const script = new vm.Script(trimmedJs, { filename: `line-${lineNumber}.js` });
      const result = await script.runInContext(context, { timeout });
      return { ok: true, result };
    }
  } catch (err) {
    const error = err;
    const payload = {
      type: error.constructor?.name ?? "Error",
      message: error.message,
      line: lineNumber,
      source: code.trim()
    };
    return { ok: false, error: payload };
  }
}

// src/sandbox/sandbox.ts
var BLOCKED_GLOBALS = [
  "process",
  "require",
  "module",
  "exports",
  "__filename",
  "__dirname",
  "eval",
  "Function"
];
var Sandbox = class {
  context;
  declaredNames = /* @__PURE__ */ new Set();
  lineCount = 0;
  timeout;
  totalExecutionMs = 0;
  resourceLimits;
  constructor(options = {}) {
    this.timeout = options.timeout ?? 3e4;
    this.resourceLimits = {
      maxTotalExecutionMs: options.resourceLimits?.maxTotalExecutionMs ?? 3e5,
      maxLines: options.resourceLimits?.maxLines ?? 5e3,
      maxVariables: options.resourceLimits?.maxVariables ?? 500
    };
    const contextGlobals = {
      React,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Promise,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Date,
      Math,
      JSON,
      Map,
      Set,
      WeakMap,
      WeakSet,
      RegExp,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      ReferenceError,
      Symbol,
      Uint8Array,
      Int32Array,
      Float64Array,
      ArrayBuffer,
      DataView,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      structuredClone,
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      ...options.globals
    };
    this.context = vm2.createContext(contextGlobals);
    for (const name of BLOCKED_GLOBALS) {
      Object.defineProperty(this.context, name, {
        get() {
          throw new Error(`${name} is not available in the sandbox`);
        },
        configurable: false
      });
    }
  }
  /**
   * Execute a line of TypeScript in the sandbox.
   */
  async execute(code) {
    if (this.lineCount >= this.resourceLimits.maxLines) {
      throw new Error(`Sandbox resource limit: max ${this.resourceLimits.maxLines} lines exceeded`);
    }
    if (this.totalExecutionMs >= this.resourceLimits.maxTotalExecutionMs) {
      throw new Error(`Sandbox resource limit: max ${this.resourceLimits.maxTotalExecutionMs}ms total execution time exceeded`);
    }
    this.lineCount++;
    const declarations = extractDeclarations(code);
    for (const name of declarations) {
      if (this.declaredNames.size >= this.resourceLimits.maxVariables && !this.declaredNames.has(name)) {
        throw new Error(`Sandbox resource limit: max ${this.resourceLimits.maxVariables} variables exceeded`);
      }
      this.declaredNames.add(name);
    }
    const startMs = Date.now();
    const result = await executeLine(code, this.lineCount, this.context, this.timeout);
    this.totalExecutionMs += Date.now() - startMs;
    return result;
  }
  /**
   * Inject a value into the sandbox's global scope.
   */
  inject(name, value) {
    this.context[name] = value;
  }
  /**
   * Get a value from the sandbox scope.
   */
  getValue(name) {
    return this.context[name];
  }
  /**
   * Get all user-declared variable names.
   */
  getDeclaredNames() {
    return [...this.declaredNames];
  }
  /**
   * Get the current scope as ScopeEntry[].
   */
  getScope() {
    const entries = [];
    for (const name of this.declaredNames) {
      try {
        const value = this.context[name];
        entries.push({
          name,
          type: describeType(value),
          value: truncateValue(value)
        });
      } catch {
        entries.push({ name, type: "unknown", value: "<error reading>" });
      }
    }
    return entries;
  }
  /**
   * Get the line count.
   */
  getLineCount() {
    return this.lineCount;
  }
  /**
   * Get the raw vm.Context (for advanced use).
   */
  getContext() {
    return this.context;
  }
  /**
   * Get current resource usage and limits.
   */
  getResourceUsage() {
    return {
      totalExecutionMs: this.totalExecutionMs,
      linesExecuted: this.lineCount,
      variableCount: this.declaredNames.size,
      limits: { ...this.resourceLimits }
    };
  }
  /**
   * Snapshot all declared variable values (deep clone via structuredClone).
   */
  snapshotScope() {
    const values = /* @__PURE__ */ new Map();
    for (const name of this.declaredNames) {
      try {
        const val = this.context[name];
        values.set(name, typeof val === "function" ? val : structuredClone(val));
      } catch {
        values.set(name, this.context[name]);
      }
    }
    return { values, declaredNames: new Set(this.declaredNames) };
  }
  /**
   * Restore sandbox scope from a snapshot. Removes variables not in the snapshot,
   * restores values for those that are, and updates declaredNames.
   */
  restoreScope(snapshot) {
    for (const name of this.declaredNames) {
      if (!snapshot.declaredNames.has(name)) {
        try {
          this.context[name] = void 0;
        } catch {
        }
      }
    }
    for (const [name, value] of snapshot.values) {
      try {
        this.context[name] = value;
      } catch {
      }
    }
    this.declaredNames = new Set(snapshot.declaredNames);
  }
  /**
   * Destroy the sandbox.
   */
  destroy() {
    this.declaredNames.clear();
  }
};
function describeType(val) {
  if (val === null) return "null";
  if (val === void 0) return "undefined";
  if (Array.isArray(val)) {
    if (val.length === 0) return "Array";
    const firstType = describeType(val[0]);
    return `Array<${firstType}>`;
  }
  const t = typeof val;
  if (t === "object") {
    const name = val.constructor?.name;
    return name && name !== "Object" ? name : "Object";
  }
  return t;
}
function truncateValue(val, maxLen = 50) {
  if (val === null) return "null";
  if (val === void 0) return "undefined";
  if (typeof val === "function") return `[Function: ${val.name || "anonymous"}]`;
  if (typeof val === "symbol") return val.toString();
  try {
    let str;
    if (typeof val === "string") {
      str = JSON.stringify(val);
    } else if (Array.isArray(val)) {
      const preview = val.slice(0, 3).map((v) => truncateValue(v, 20)).join(", ");
      str = val.length > 3 ? `[${preview}, ... +${val.length - 3}]` : `[${preview}]`;
    } else if (typeof val === "object") {
      const keys = Object.keys(val);
      const preview = keys.slice(0, 5).join(", ");
      str = keys.length > 5 ? `{${preview}, ... +${keys.length - 5}}` : `{${preview}}`;
    } else {
      str = String(val);
    }
    if (str.length > maxLen) {
      return str.slice(0, maxLen - 3) + "...";
    }
    return str;
  } catch {
    return "[value]";
  }
}

// src/stream/serializer.ts
var DEFAULT_LIMITS = {
  maxStringLength: 2e3,
  maxArrayElements: 50,
  maxObjectKeys: 20,
  maxDepth: 5
};
function serialize(value, limits = {}) {
  const opts = { ...DEFAULT_LIMITS, ...limits };
  const seen = /* @__PURE__ */ new WeakSet();
  return serializeValue(value, opts, seen, 0);
}
function serializeValue(value, limits, seen, depth) {
  if (value === null) return "null";
  if (value === void 0) return "undefined";
  const type = typeof value;
  if (type === "string") {
    const str = value;
    if (str.length > limits.maxStringLength) {
      const half = Math.floor(limits.maxStringLength / 2);
      return JSON.stringify(str.slice(0, half) + `... (truncated, ${str.length} chars total)`);
    }
    return JSON.stringify(str);
  }
  if (type === "number" || type === "boolean") {
    return JSON.stringify(value);
  }
  if (type === "function") {
    const fn = value;
    return `[Function: ${fn.name || "anonymous"}]`;
  }
  if (type === "symbol") {
    return `[Symbol: ${value.description ?? ""}]`;
  }
  if (type === "bigint") {
    return `${value}n`;
  }
  if (value instanceof Error) {
    return `[Error: ${value.message}]`;
  }
  if (value instanceof Promise) {
    return "[Promise]";
  }
  if (value instanceof Date) {
    return `"${value.toISOString()}"`;
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (type === "object") {
    const obj = value;
    if (seen.has(obj)) return "[Circular]";
    seen.add(obj);
    if (depth >= limits.maxDepth) {
      if (Array.isArray(obj)) return `[Array(${obj.length})]`;
      return `[Object]`;
    }
    if (Array.isArray(obj)) {
      return serializeArray(obj, limits, seen, depth);
    }
    if (obj instanceof Map) {
      const entries = [];
      let count = 0;
      for (const [k, v] of obj) {
        if (count >= limits.maxObjectKeys) {
          entries.push(`... +${obj.size - count} more`);
          break;
        }
        entries.push(`${serializeValue(k, limits, seen, depth + 1)}: ${serializeValue(v, limits, seen, depth + 1)}`);
        count++;
      }
      return `Map { ${entries.join(", ")} }`;
    }
    if (obj instanceof Set) {
      const items = [];
      let count = 0;
      for (const v of obj) {
        if (count >= limits.maxArrayElements) {
          items.push(`... +${obj.size - count} more`);
          break;
        }
        items.push(serializeValue(v, limits, seen, depth + 1));
        count++;
      }
      return `Set { ${items.join(", ")} }`;
    }
    return serializeObject(obj, limits, seen, depth);
  }
  return String(value);
}
function serializeArray(arr, limits, seen, depth) {
  if (arr.length === 0) return "[]";
  const items = [];
  const max = Math.min(arr.length, limits.maxArrayElements);
  for (let i = 0; i < max; i++) {
    items.push(serializeValue(arr[i], limits, seen, depth + 1));
  }
  if (arr.length > limits.maxArrayElements) {
    items.push(`... +${arr.length - limits.maxArrayElements} more`);
  }
  return `[${items.join(", ")}]`;
}
function serializeObject(obj, limits, seen, depth) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  const entries = [];
  const max = Math.min(keys.length, limits.maxObjectKeys);
  for (let i = 0; i < max; i++) {
    const key = keys[i];
    const val = obj[key];
    entries.push(`${JSON.stringify(key)}: ${serializeValue(val, limits, seen, depth + 1)}`);
  }
  if (keys.length > limits.maxObjectKeys) {
    entries.push(`... +${keys.length - limits.maxObjectKeys} more`);
  }
  return `{ ${entries.join(", ")} }`;
}

// src/context/knowledge-decay.ts
var KNOWLEDGE_TAG = /* @__PURE__ */ Symbol.for("lmthing:knowledge");
var DEFAULT_TIERS = {
  full: 0,
  truncated: 2,
  headers: 4
};
function getKnowledgeDecayLevel(distance, tiers = DEFAULT_TIERS) {
  if (distance <= tiers.full) return "full";
  if (distance <= tiers.truncated) return "truncated";
  if (distance <= tiers.headers) return "headers";
  return "names";
}
function isKnowledgeContent(value) {
  return value !== null && typeof value === "object" && value[KNOWLEDGE_TAG] === true;
}
function tagAsKnowledge(obj) {
  Object.defineProperty(obj, KNOWLEDGE_TAG, {
    value: true,
    enumerable: false,
    configurable: false
  });
  return obj;
}
function decayKnowledgeValue(content, distance, tiers = DEFAULT_TIERS) {
  const level = getKnowledgeDecayLevel(distance, tiers);
  switch (level) {
    case "full":
      return formatFull(content);
    case "truncated":
      return formatTruncated(content);
    case "headers":
      return formatHeaders(content);
    case "names":
      return formatNames(content);
  }
}
function formatFull(content) {
  return serializeNested(content, (md) => JSON.stringify(md));
}
function formatTruncated(content) {
  return serializeNested(content, (md) => {
    if (md.length <= 300) return JSON.stringify(md);
    return JSON.stringify(md.slice(0, 300) + `...(truncated, ${md.length} chars)`);
  });
}
function formatHeaders(content) {
  return serializeNested(content, (md) => {
    const headers = md.split("\n").filter((line) => /^#{1,4}\s/.test(line)).join(" | ");
    return JSON.stringify(headers || "(no headings)");
  });
}
function formatNames(content) {
  const paths = [];
  collectPaths(content, [], paths);
  return `[knowledge: ${paths.join(", ")}]`;
}
function collectPaths(obj, prefix, out) {
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      out.push([...prefix, key].join("/"));
    } else if (typeof value === "object" && value !== null) {
      collectPaths(value, [...prefix, key], out);
    }
  }
}
function serializeNested(content, formatLeaf) {
  return serializeLevel(content, formatLeaf);
}
function serializeLevel(obj, formatLeaf) {
  const entries = [];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      entries.push(`${JSON.stringify(key)}: ${formatLeaf(value)}`);
    } else if (typeof value === "object" && value !== null) {
      entries.push(`${JSON.stringify(key)}: ${serializeLevel(value, formatLeaf)}`);
    }
  }
  return `{ ${entries.join(", ")} }`;
}

// src/sandbox/globals.ts
function createGlobals(config) {
  const {
    pauseController,
    renderSurface,
    asyncManager,
    askTimeout = 3e5
  } = config;
  const tasklistsState = {
    tasklists: /* @__PURE__ */ new Map()
  };
  let focusSections = null;
  const checkpoints = /* @__PURE__ */ new Map();
  const pinnedMemory = /* @__PURE__ */ new Map();
  const memoMemory = /* @__PURE__ */ new Map();
  let pinTurnCounter = 0;
  let currentSource = "";
  function setCurrentSource(source) {
    currentSource = source;
  }
  let stopResolve = null;
  async function stopFn(...values) {
    const argNames = recoverArgumentNames(currentSource);
    const resolved = await Promise.allSettled(
      values.map((v) => v instanceof Promise ? v : Promise.resolve(v))
    );
    const payload = {};
    for (let i = 0; i < resolved.length; i++) {
      const key = argNames[i] ?? `arg_${i}`;
      const settlement = resolved[i];
      const value = settlement.status === "fulfilled" ? settlement.value : {
        _error: settlement.reason instanceof Error ? settlement.reason.message : String(settlement.reason)
      };
      payload[key] = {
        value,
        display: serialize(value, config.serializationLimits)
      };
    }
    const asyncPayload = asyncManager.buildStopPayload();
    for (const [key, val] of Object.entries(asyncPayload)) {
      payload[key] = {
        value: val,
        display: serialize(val, config.serializationLimits)
      };
    }
    const promise = new Promise((resolve2) => {
      stopResolve = resolve2;
    });
    pauseController.pause();
    config.onStop?.(payload, currentSource);
    return promise;
  }
  function resolveStop() {
    if (stopResolve) {
      const resolve2 = stopResolve;
      stopResolve = null;
      resolve2();
    }
  }
  function displayFn(element) {
    const id = `display_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    renderSurface.append(id, element);
    config.onDisplay?.(id);
  }
  async function askFn(element) {
    const formId = `form_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    pauseController.pause();
    try {
      const result = await Promise.race([
        renderSurface.renderForm(formId, element),
        new Promise(
          (resolve2) => setTimeout(() => resolve2({ _timeout: true }), askTimeout)
        )
      ]);
      return result;
    } finally {
      pauseController.resume();
    }
  }
  function asyncFn(fn, label) {
    const derivedLabel = label ?? deriveLabel(currentSource);
    const taskId = asyncManager.register(
      (signal) => fn(),
      derivedLabel
    );
    config.onAsyncStart?.(taskId, derivedLabel);
  }
  function tasklistFn(tasklistId, description, tasks) {
    if (tasklistsState.tasklists.has(tasklistId)) {
      throw new Error(`tasklist() tasklist "${tasklistId}" already declared`);
    }
    if (!tasklistId) {
      throw new Error("tasklist() requires a tasklistId");
    }
    if (!description || !Array.isArray(tasks) || tasks.length === 0) {
      throw new Error("tasklist() requires a description and at least one task");
    }
    const maxTasks = config.maxTasksPerTasklist ?? 20;
    if (tasks.length > maxTasks) {
      throw new Error(`tasklist() exceeds maximum of ${maxTasks} tasks per tasklist`);
    }
    const ids = /* @__PURE__ */ new Set();
    for (const task of tasks) {
      if (!task.id || !task.instructions || !task.outputSchema) {
        throw new Error("Each task must have id, instructions, and outputSchema");
      }
      if (ids.has(task.id)) {
        throw new Error(`Duplicate task id: ${task.id}`);
      }
      ids.add(task.id);
    }
    for (const task of tasks) {
      if (task.dependsOn) {
        for (const dep of task.dependsOn) {
          if (!ids.has(dep)) {
            throw new Error(`Task "${task.id}" depends on unknown task "${dep}" in tasklist "${tasklistId}"`);
          }
          if (dep === task.id) {
            throw new Error(`Task "${task.id}" cannot depend on itself`);
          }
        }
      }
    }
    const hasDependsOn = tasks.some((t) => t.dependsOn && t.dependsOn.length > 0);
    if (!hasDependsOn) {
      for (let i = 1; i < tasks.length; i++) {
        tasks[i] = { ...tasks[i], dependsOn: [tasks[i - 1].id] };
      }
    }
    const visited = /* @__PURE__ */ new Set();
    const visiting = /* @__PURE__ */ new Set();
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    function visit(id) {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Cycle detected in tasklist "${tasklistId}" involving task "${id}"`);
      }
      visiting.add(id);
      const task = taskMap.get(id);
      if (task.dependsOn) {
        for (const dep of task.dependsOn) {
          visit(dep);
        }
      }
      visiting.delete(id);
      visited.add(id);
    }
    for (const task of tasks) {
      visit(task.id);
    }
    const readyTasks = /* @__PURE__ */ new Set();
    for (const task of tasks) {
      if (!task.dependsOn || task.dependsOn.length === 0) {
        readyTasks.add(task.id);
      }
    }
    const plan = { tasklistId, description, tasks };
    const tasklistState = {
      plan,
      completed: /* @__PURE__ */ new Map(),
      readyTasks,
      runningTasks: /* @__PURE__ */ new Set(),
      outputs: /* @__PURE__ */ new Map(),
      progressMessages: /* @__PURE__ */ new Map(),
      retryCount: /* @__PURE__ */ new Map()
    };
    tasklistsState.tasklists.set(tasklistId, tasklistState);
    renderSurface.appendTasklistProgress?.(tasklistId, tasklistState);
    config.onTasklistDeclared?.(tasklistId, plan);
  }
  function completeTaskFn(tasklistId, id, output) {
    const tasklist = tasklistsState.tasklists.get(tasklistId);
    if (!tasklist) {
      throw new Error(`completeTask() called with unknown tasklist "${tasklistId}" \u2014 declare it with tasklist() first`);
    }
    const task = tasklist.plan.tasks.find((t) => t.id === id);
    if (!task) {
      throw new Error(`Unknown task id: ${id} in tasklist "${tasklistId}"`);
    }
    if (tasklist.completed.has(id)) {
      throw new Error(`Task "${id}" in tasklist "${tasklistId}" already completed`);
    }
    if (!tasklist.readyTasks.has(id)) {
      const isRunning = tasklist.runningTasks.has(id);
      if (isRunning) {
        throw new Error(`Task "${id}" in tasklist "${tasklistId}" is already running via completeTaskAsync()`);
      }
      const pendingDeps = (task.dependsOn ?? []).filter((dep) => {
        const c = tasklist.completed.get(dep);
        return !c || c.status !== "completed";
      });
      const readyTaskDetails = [...tasklist.readyTasks].map((readyId) => {
        const readyTask = tasklist.plan.tasks.find((t) => t.id === readyId);
        return { id: readyId, instructions: readyTask.instructions, outputSchema: readyTask.outputSchema };
      });
      config.onTaskOrderViolation?.(tasklistId, id, readyTaskDetails);
      throw new Error(
        `Task "${id}" in tasklist "${tasklistId}" is not ready. Waiting on: ${pendingDeps.join(", ")}`
      );
    }
    for (const [key, schema] of Object.entries(task.outputSchema)) {
      if (!(key in output)) {
        throw new Error(`Task "${id}" output missing required key: ${key}`);
      }
      const expectedType = schema.type;
      const value = output[key];
      const actual = Array.isArray(value) ? "array" : typeof value;
      if (actual !== expectedType) {
        throw new Error(
          `Task "${id}" output key "${key}": expected ${expectedType}, got ${actual}`
        );
      }
    }
    tasklist.completed.set(id, {
      output,
      timestamp: Date.now(),
      status: "completed"
    });
    tasklist.readyTasks.delete(id);
    tasklist.outputs.set(id, output);
    recomputeReadyTasks(tasklist);
    renderSurface.updateTasklistProgress?.(tasklistId, tasklist);
    config.onTaskComplete?.(tasklistId, id, output);
    const hasRemainingTasks = tasklist.plan.tasks.some((t) => {
      const c = tasklist.completed.get(t.id);
      return (!c || c.status !== "completed" && c.status !== "skipped") && !t.optional;
    });
    if (hasRemainingTasks && tasklist.readyTasks.size > 0) {
      const readyTaskDetails = [...tasklist.readyTasks].map((readyId) => {
        const readyTask = tasklist.plan.tasks.find((t) => t.id === readyId);
        return { id: readyId, instructions: readyTask.instructions, outputSchema: readyTask.outputSchema };
      });
      config.onTaskCompleteContinue?.(tasklistId, id, readyTaskDetails);
    }
  }
  function recomputeReadyTasks(tasklist) {
    for (const task of tasklist.plan.tasks) {
      if (tasklist.completed.has(task.id) || tasklist.readyTasks.has(task.id) || tasklist.runningTasks.has(task.id)) {
        continue;
      }
      const deps = task.dependsOn ?? [];
      const allDepsSatisfied = deps.every((dep) => {
        const c = tasklist.completed.get(dep);
        return c && (c.status === "completed" || c.status === "skipped" || c.status === "failed" && tasklist.plan.tasks.find((t) => t.id === dep)?.optional);
      });
      if (allDepsSatisfied) {
        if (task.condition) {
          const conditionMet = evaluateCondition(task.condition, tasklist.outputs);
          if (!conditionMet) {
            tasklist.completed.set(task.id, {
              output: {},
              timestamp: Date.now(),
              status: "skipped"
            });
            config.onTaskSkipped?.(tasklist.plan.tasklistId, task.id, "condition was falsy");
            recomputeReadyTasks(tasklist);
            return;
          }
        }
        tasklist.readyTasks.add(task.id);
      }
    }
  }
  function evaluateCondition(condition, outputs) {
    try {
      const ctx = Object.fromEntries(outputs);
      const paramNames = Object.keys(ctx);
      const paramValues = Object.values(ctx);
      const fn = new Function(...paramNames, `return !!(${condition})`);
      return fn(...paramValues);
    } catch {
      return false;
    }
  }
  function completeTaskAsyncFn(tasklistId, taskId, fn) {
    const tasklist = tasklistsState.tasklists.get(tasklistId);
    if (!tasklist) {
      throw new Error(`completeTaskAsync() called with unknown tasklist "${tasklistId}"`);
    }
    const task = tasklist.plan.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Unknown task id: ${taskId} in tasklist "${tasklistId}"`);
    }
    if (tasklist.completed.has(taskId)) {
      throw new Error(`Task "${taskId}" in tasklist "${tasklistId}" already completed`);
    }
    if (!tasklist.readyTasks.has(taskId)) {
      const readyTaskDetails = [...tasklist.readyTasks].map((readyId) => {
        const readyTask = tasklist.plan.tasks.find((t) => t.id === readyId);
        return { id: readyId, instructions: readyTask.instructions, outputSchema: readyTask.outputSchema };
      });
      config.onTaskOrderViolation?.(tasklistId, taskId, readyTaskDetails);
      throw new Error(`Task "${taskId}" in tasklist "${tasklistId}" is not ready`);
    }
    tasklist.readyTasks.delete(taskId);
    tasklist.runningTasks.add(taskId);
    config.onTaskAsyncStart?.(tasklistId, taskId);
    const startTime = Date.now();
    const promise = fn().then((output) => {
      for (const [key, schema] of Object.entries(task.outputSchema)) {
        if (!(key in output)) {
          throw new Error(`Task "${taskId}" output missing required key: ${key}`);
        }
        const expectedType = schema.type;
        const value = output[key];
        const actual = Array.isArray(value) ? "array" : typeof value;
        if (actual !== expectedType) {
          throw new Error(
            `Task "${taskId}" output key "${key}": expected ${expectedType}, got ${actual}`
          );
        }
      }
      tasklist.runningTasks.delete(taskId);
      tasklist.completed.set(taskId, {
        output,
        timestamp: Date.now(),
        status: "completed",
        duration: Date.now() - startTime
      });
      tasklist.outputs.set(taskId, output);
      asyncManager.setResult(`task:${taskId}`, output);
      recomputeReadyTasks(tasklist);
      renderSurface.updateTasklistProgress?.(tasklistId, tasklist);
      config.onTaskAsyncComplete?.(tasklistId, taskId, output);
    }).catch((err) => {
      const error = err instanceof Error ? err.message : String(err);
      tasklist.runningTasks.delete(taskId);
      tasklist.completed.set(taskId, {
        output: {},
        timestamp: Date.now(),
        status: "failed",
        error,
        duration: Date.now() - startTime
      });
      asyncManager.setResult(`task:${taskId}`, { error });
      if (task.optional) {
        recomputeReadyTasks(tasklist);
      }
      renderSurface.updateTasklistProgress?.(tasklistId, tasklist);
      config.onTaskAsyncFailed?.(tasklistId, taskId, error);
    });
  }
  function taskProgressFn(tasklistId, taskId, message, percent) {
    const tasklist = tasklistsState.tasklists.get(tasklistId);
    if (!tasklist) {
      throw new Error(`taskProgress() called with unknown tasklist "${tasklistId}"`);
    }
    const task = tasklist.plan.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Unknown task id: ${taskId} in tasklist "${tasklistId}"`);
    }
    if (!tasklist.readyTasks.has(taskId) && !tasklist.runningTasks.has(taskId)) {
      throw new Error(`Task "${taskId}" in tasklist "${tasklistId}" is not in ready or running state`);
    }
    tasklist.progressMessages.set(taskId, { message, percent });
    renderSurface.updateTaskProgress?.(tasklistId, taskId, message, percent);
    config.onTaskProgress?.(tasklistId, taskId, message, percent);
  }
  function failTaskFn(tasklistId, taskId, error) {
    const tasklist = tasklistsState.tasklists.get(tasklistId);
    if (!tasklist) {
      throw new Error(`failTask() called with unknown tasklist "${tasklistId}"`);
    }
    const task = tasklist.plan.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Unknown task id: ${taskId} in tasklist "${tasklistId}"`);
    }
    if (!tasklist.readyTasks.has(taskId) && !tasklist.runningTasks.has(taskId)) {
      throw new Error(`Task "${taskId}" in tasklist "${tasklistId}" is not in ready or running state`);
    }
    tasklist.readyTasks.delete(taskId);
    tasklist.runningTasks.delete(taskId);
    tasklist.completed.set(taskId, {
      output: {},
      timestamp: Date.now(),
      status: "failed",
      error
    });
    if (task.optional) {
      recomputeReadyTasks(tasklist);
    }
    renderSurface.updateTasklistProgress?.(tasklistId, tasklist);
    config.onTaskFailed?.(tasklistId, taskId, error);
  }
  function retryTaskFn(tasklistId, taskId) {
    const tasklist = tasklistsState.tasklists.get(tasklistId);
    if (!tasklist) {
      throw new Error(`retryTask() called with unknown tasklist "${tasklistId}"`);
    }
    const task = tasklist.plan.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Unknown task id: ${taskId} in tasklist "${tasklistId}"`);
    }
    const completion = tasklist.completed.get(taskId);
    if (!completion || completion.status !== "failed") {
      throw new Error(`retryTask() can only retry failed tasks. Task "${taskId}" status: ${completion?.status ?? "not completed"}`);
    }
    const maxRetries = config.maxTaskRetries ?? 3;
    const currentRetries = tasklist.retryCount.get(taskId) ?? 0;
    if (currentRetries >= maxRetries) {
      throw new Error(`Task "${taskId}" has exceeded maximum retries (${maxRetries})`);
    }
    tasklist.retryCount.set(taskId, currentRetries + 1);
    tasklist.completed.delete(taskId);
    tasklist.outputs.delete(taskId);
    tasklist.readyTasks.add(taskId);
    tasklist.progressMessages.delete(taskId);
    renderSurface.updateTasklistProgress?.(tasklistId, tasklist);
    config.onTaskRetried?.(tasklistId, taskId);
  }
  async function sleepFn(seconds) {
    const maxSeconds = config.sleepMaxSeconds ?? 30;
    const capped = Math.min(Math.max(0, seconds), maxSeconds);
    await new Promise((resolve2) => setTimeout(resolve2, capped * 1e3));
  }
  function loadKnowledgeFn(selector) {
    if (!selector || typeof selector !== "object") {
      throw new Error("loadKnowledge() requires a selector object: { spaceName: { domain: { field: { option: true } } } }");
    }
    if (!config.onLoadKnowledge) {
      throw new Error("loadKnowledge() is not available \u2014 no space loaded");
    }
    return tagAsKnowledge(config.onLoadKnowledge(selector));
  }
  const loadedClasses = /* @__PURE__ */ new Set();
  function loadClassFn(className) {
    if (typeof className !== "string" || !className) {
      throw new Error("loadClass() requires a class name string");
    }
    if (loadedClasses.has(className)) return;
    if (!config.getClassInfo) {
      throw new Error("loadClass() is not available \u2014 no classes exported");
    }
    const result = config.getClassInfo(className);
    if (!result) {
      throw new Error(`Unknown class: "${className}"`);
    }
    loadedClasses.add(className);
    config.onLoadClass?.(className);
  }
  async function askParentFn(message, schema = {}) {
    if (typeof message !== "string" || !message) {
      throw new Error("askParent() requires a message string as first argument");
    }
    if (config.isFireAndForget || !config.onAskParent) {
      return { _noParent: true };
    }
    pauseController.pause();
    try {
      const result = await Promise.race([
        config.onAskParent({ message, schema }),
        new Promise(
          (resolve2) => setTimeout(() => resolve2({ _timeout: true }), askTimeout)
        )
      ]);
      return result;
    } finally {
      pauseController.resume();
    }
  }
  function respondFn(promise, data) {
    if (!config.onRespond) throw new Error("respond() is not available");
    if (!data || typeof data !== "object") {
      throw new Error("respond() requires a data object as second argument");
    }
    config.onRespond(promise, data);
  }
  function traceFn() {
    if (!config.onTrace) {
      return {
        turns: 0,
        llmCalls: 0,
        llmTokens: { input: 0, output: 0, total: 0 },
        estimatedCost: "$0.00",
        asyncTasks: { completed: 0, failed: 0, running: 0 },
        scopeSize: 0,
        pinnedCount: pinnedMemory.size,
        memoCount: memoMemory.size,
        sessionDurationMs: 0
      };
    }
    return config.onTrace();
  }
  const watchers = /* @__PURE__ */ new Map();
  function watchFn(variableName, callback) {
    watchers.set(variableName, { callback, lastValue: void 0 });
    return () => {
      watchers.delete(variableName);
    };
  }
  async function pipelineFn(data, ...transforms) {
    let current = data;
    const steps = [];
    for (const transform of transforms) {
      const start = Date.now();
      try {
        current = await Promise.resolve(transform.fn(current));
        steps.push({ name: transform.name, durationMs: Date.now() - start, ok: true });
      } catch (err) {
        steps.push({ name: transform.name, durationMs: Date.now() - start, ok: false, error: err?.message ?? String(err) });
        return { result: current, steps };
      }
    }
    return { result: current, steps };
  }
  const fetchCache = /* @__PURE__ */ new Map();
  async function cachedFetchFn(url, options) {
    const cacheKey = `${options?.method ?? "GET"}:${url}`;
    const ttl = options?.cacheTtlMs ?? 0;
    if (ttl > 0) {
      const cached = fetchCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < cached.ttl) {
        return { data: cached.data, cached: true, status: 200, durationMs: 0 };
      }
    }
    const maxRetries = options?.maxRetries ?? 2;
    const timeout = Math.min(options?.timeout ?? 3e4, 6e4);
    const start = Date.now();
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, Math.min(1e3 * Math.pow(2, attempt - 1), 8e3)));
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const response = await fetch(url, {
          method: options?.method ?? "GET",
          headers: options?.headers,
          body: options?.body,
          signal: controller.signal
        });
        clearTimeout(timer);
        const parseAs = options?.parseAs ?? (response.headers.get("content-type")?.includes("json") ? "json" : "text");
        const data = parseAs === "json" ? await response.json() : await response.text();
        if (ttl > 0 && response.ok) {
          fetchCache.set(cacheKey, { data, timestamp: Date.now(), ttl });
          if (fetchCache.size > 50) {
            const oldest = [...fetchCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
            if (oldest) fetchCache.delete(oldest[0]);
          }
        }
        return { data, cached: false, status: response.status, durationMs: Date.now() - start };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error("cachedFetch: all retries failed");
  }
  function schemaFn(value) {
    return inferSchema(value);
  }
  function validateFn(value, schema) {
    const errors = [];
    checkSchema(value, schema, "", errors);
    return errors.length === 0 ? { valid: true } : { valid: false, errors };
  }
  async function delegateFn(task, options) {
    const start = Date.now();
    const strategy = options?.strategy ?? "auto";
    const timeout = options?.timeout ?? 3e4;
    if (typeof task === "function") {
      const result = await Promise.race([
        Promise.resolve(task()),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeout))
      ]);
      return { strategy: "direct", result, durationMs: Date.now() - start };
    }
    if (strategy === "direct") {
      throw new Error('delegate: cannot use "direct" strategy with string tasks \u2014 use a function instead');
    }
    if (strategy === "fork" || strategy === "auto") {
      if (!config.onFork) throw new Error("delegate: fork not available");
      const forkResult = await config.onFork({
        task,
        context: options?.context,
        maxTurns: 2
      });
      return { strategy: "fork", result: forkResult.output, durationMs: Date.now() - start };
    }
    throw new Error(`delegate: unknown strategy "${strategy}"`);
  }
  const eventListeners = /* @__PURE__ */ new Map();
  const eventBuffer = /* @__PURE__ */ new Map();
  function broadcastFn(channel, data) {
    const listeners = eventListeners.get(channel);
    if (listeners && listeners.length > 0) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch {
        }
      }
    }
    let buffer = eventBuffer.get(channel);
    if (!buffer) {
      buffer = [];
      eventBuffer.set(channel, buffer);
    }
    buffer.push(data);
    if (buffer.length > 10) buffer.shift();
  }
  function listenFn(channel, callback) {
    if (!callback) {
      const buffer = eventBuffer.get(channel) ?? [];
      eventBuffer.delete(channel);
      return [...buffer];
    }
    let listeners = eventListeners.get(channel);
    if (!listeners) {
      listeners = [];
      eventListeners.set(channel, listeners);
    }
    listeners.push(callback);
    return () => {
      const ls = eventListeners.get(channel);
      if (ls) {
        const idx = ls.indexOf(callback);
        if (idx !== -1) ls.splice(idx, 1);
      }
    };
  }
  async function learnFn(topic, insight, tags) {
    if (!config.onLearn) {
      throw new Error("learn: knowledge persistence not available");
    }
    return config.onLearn(topic, insight, tags);
  }
  async function critiqueFn(output, criteria, context) {
    if (!config.onCritique) {
      throw new Error("critique: LLM critique not available");
    }
    return config.onCritique(output, criteria, context);
  }
  async function planFn(goal, constraints) {
    if (!config.onPlan) {
      throw new Error("plan: LLM planning not available");
    }
    return config.onPlan(goal, constraints);
  }
  async function parallelFn(tasks, options) {
    if (tasks.length === 0) return [];
    if (tasks.length > 10) throw new Error("parallel: max 10 concurrent tasks");
    const timeout = Math.min(options?.timeout ?? 3e4, 6e4);
    const failFast = options?.failFast ?? false;
    const controller = failFast ? new AbortController() : null;
    const results = await Promise.allSettled(
      tasks.map(async (task) => {
        const start = Date.now();
        try {
          const result = await Promise.race([
            Promise.resolve(task.fn()),
            new Promise(
              (_, reject) => setTimeout(() => reject(new Error("timeout")), timeout)
            ),
            ...controller ? [new Promise((_, reject) => {
              controller.signal.addEventListener("abort", () => reject(new Error("fail-fast abort")));
            })] : []
          ]);
          return { label: task.label, ok: true, result, durationMs: Date.now() - start };
        } catch (err) {
          if (failFast && controller && !controller.signal.aborted) {
            controller.abort();
          }
          return { label: task.label, ok: false, error: err?.message ?? String(err), durationMs: Date.now() - start };
        }
      })
    );
    return results.map(
      (r) => r.status === "fulfilled" ? r.value : { label: "?", ok: false, error: r.reason?.message ?? "unknown", durationMs: 0 }
    );
  }
  function checkpointFn(id) {
    if (checkpoints.size >= 5) {
      const oldestKey = checkpoints.keys().next().value;
      checkpoints.delete(oldestKey);
    }
    if (!config.onCheckpoint) {
      throw new Error("checkpoint: sandbox snapshotting not available");
    }
    const snap = config.onCheckpoint();
    checkpoints.set(id, {
      id,
      timestamp: Date.now(),
      scopeSnapshot: snap.values,
      declaredNames: snap.declaredNames
    });
    return id;
  }
  function rollbackFn(id) {
    const cp = checkpoints.get(id);
    if (!cp) {
      throw new Error(`rollback: no checkpoint named "${id}" \u2014 available: [${[...checkpoints.keys()].join(", ")}]`);
    }
    if (!config.onRollback) {
      throw new Error("rollback: sandbox restoration not available");
    }
    config.onRollback({
      values: cp.scopeSnapshot,
      declaredNames: cp.declaredNames
    });
  }
  function guardFn(condition, message) {
    if (!condition) {
      const err = new Error(message);
      err.name = "GuardError";
      throw err;
    }
  }
  function focusFn(...sections) {
    if (sections.length === 0 || sections.length === 1 && sections[0] === "all") {
      focusSections = null;
      return;
    }
    const valid = /* @__PURE__ */ new Set(["functions", "knowledge", "components", "classes", "agents"]);
    for (const s of sections) {
      if (!valid.has(s)) {
        throw new Error(`focus() unknown section: "${s}". Valid: ${[...valid].join(", ")}, or 'all'`);
      }
    }
    focusSections = new Set(sections);
  }
  async function forkFn(request) {
    if (!request || typeof request !== "object" || !request.task) {
      throw new Error("fork() requires { task: string, context?: object, outputSchema?: object, maxTurns?: number }");
    }
    if (!config.onFork) {
      throw new Error("fork() is not available \u2014 no fork handler configured");
    }
    return config.onFork(request);
  }
  async function compressFn(data, options) {
    const dataStr = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    if (!dataStr || dataStr.length < 100) {
      return dataStr;
    }
    if (!config.onCompress) {
      const maxLen = (options?.maxTokens ?? 200) * 4;
      if (dataStr.length <= maxLen) return dataStr;
      return dataStr.slice(0, maxLen) + "\n...(truncated)";
    }
    return config.onCompress(dataStr, options ?? {});
  }
  async function speculateFn(branches, options) {
    if (!Array.isArray(branches) || branches.length === 0) {
      throw new Error("speculate() requires a non-empty array of branches");
    }
    if (branches.length > 5) {
      throw new Error("speculate() supports max 5 branches");
    }
    const timeout = options?.timeout ?? 1e4;
    if (config.onSpeculate) {
      return config.onSpeculate(branches, timeout);
    }
    const results = await Promise.all(
      branches.map(async (branch) => {
        const start = Date.now();
        try {
          const result = await Promise.race([
            Promise.resolve().then(() => branch.fn()),
            new Promise(
              (_, reject) => setTimeout(() => reject(new Error("Branch timed out")), timeout)
            )
          ]);
          return {
            label: branch.label,
            ok: true,
            result,
            durationMs: Date.now() - start
          };
        } catch (err) {
          return {
            label: branch.label,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - start
          };
        }
      })
    );
    return { results };
  }
  async function vectorSearchFn(query, topK = 5) {
    if (typeof query !== "string" || !query) {
      throw new Error("vectorSearch() requires a non-empty query string");
    }
    if (!config.onVectorSearch) {
      throw new Error("vectorSearch() is not available \u2014 no vector index configured");
    }
    return config.onVectorSearch(query, topK);
  }
  async function reflectFn(request) {
    if (!request || typeof request !== "object" || !request.question) {
      throw new Error("reflect() requires { question: string, context?: object, criteria?: string[] }");
    }
    if (!config.onReflect) {
      throw new Error("reflect() is not available \u2014 no reflection model configured");
    }
    return config.onReflect(request);
  }
  function pinFn(key, value) {
    if (typeof key !== "string" || !key) {
      throw new Error("pin() requires a non-empty string key as first argument");
    }
    if (pinnedMemory.size >= 10 && !pinnedMemory.has(key)) {
      throw new Error("pin() limit reached (max 10 pins). Unpin an existing key first.");
    }
    const display = serialize(value, {
      maxStringLength: 500,
      maxArrayElements: 20,
      maxObjectKeys: 10,
      maxDepth: 3
    });
    pinnedMemory.set(key, { value, display, turn: pinTurnCounter });
  }
  function unpinFn(key) {
    if (typeof key !== "string" || !key) {
      throw new Error("unpin() requires a non-empty string key");
    }
    pinnedMemory.delete(key);
  }
  function memoFn(key, value) {
    if (typeof key !== "string" || !key) {
      throw new Error("memo() requires a non-empty string key");
    }
    if (arguments.length === 1) {
      return memoMemory.get(key);
    }
    if (value === null) {
      memoMemory.delete(key);
      return void 0;
    }
    if (typeof value !== "string") {
      throw new Error("memo() value must be a string or null");
    }
    if (value.length > 500) {
      throw new Error(`memo() value exceeds 500 char limit (got ${value.length}). Compress further.`);
    }
    if (memoMemory.size >= 20 && !memoMemory.has(key)) {
      throw new Error("memo() limit reached (max 20 memos). Delete an existing memo first.");
    }
    memoMemory.set(key, value);
    return value;
  }
  function contextBudgetFn() {
    if (!config.onContextBudget) {
      return {
        totalTokens: 1e5,
        usedTokens: 0,
        remainingTokens: 1e5,
        systemPromptTokens: 0,
        messageHistoryTokens: 0,
        turnNumber: 0,
        decayLevel: { stops: "full", knowledge: "full" },
        recommendation: "nominal"
      };
    }
    return config.onContextBudget();
  }
  return {
    stop: stopFn,
    display: displayFn,
    ask: askFn,
    async: asyncFn,
    tasklist: tasklistFn,
    completeTask: completeTaskFn,
    completeTaskAsync: completeTaskAsyncFn,
    taskProgress: taskProgressFn,
    failTask: failTaskFn,
    retryTask: retryTaskFn,
    sleep: sleepFn,
    loadKnowledge: loadKnowledgeFn,
    loadClass: loadClassFn,
    askParent: askParentFn,
    respond: respondFn,
    contextBudget: contextBudgetFn,
    pin: pinFn,
    unpin: unpinFn,
    memo: memoFn,
    reflect: reflectFn,
    speculate: speculateFn,
    vectorSearch: vectorSearchFn,
    compress: compressFn,
    fork: forkFn,
    focus: focusFn,
    guard: guardFn,
    trace: traceFn,
    checkpoint: checkpointFn,
    rollback: rollbackFn,
    parallel: parallelFn,
    plan: planFn,
    critique: critiqueFn,
    learn: learnFn,
    broadcast: broadcastFn,
    listen: listenFn,
    delegate: delegateFn,
    schema: schemaFn,
    validate: validateFn,
    cachedFetch: cachedFetchFn,
    pipeline: pipelineFn,
    watch: watchFn,
    setCurrentSource,
    resolveStop,
    getTasklistsState: () => tasklistsState,
    getPinnedMemory: () => pinnedMemory,
    getMemoMemory: () => memoMemory,
    getFocusSections: () => focusSections,
    setPinTurn: (turn) => {
      pinTurnCounter = turn;
    },
    checkWatchers: (getVar) => {
      for (const [name, entry] of watchers) {
        try {
          const current = getVar(name);
          const currentStr = JSON.stringify(current);
          const lastStr = JSON.stringify(entry.lastValue);
          if (currentStr !== lastStr) {
            const oldVal = entry.lastValue;
            entry.lastValue = current;
            try {
              entry.callback(current, oldVal);
            } catch {
            }
          }
        } catch {
        }
      }
    }
  };
}
function deriveLabel(source) {
  const commentMatch = source.match(/\/\/\s*(.+)$/);
  if (commentMatch) return commentMatch[1].trim();
  const callMatch = source.match(/=>\s*(?:\{[^}]*)?(\w+)\s*\(/);
  if (callMatch) return callMatch[1];
  return "background task";
}
function inferSchema(value, depth = 0) {
  if (depth > 5) return { type: "unknown" };
  if (value === null) return { type: "null" };
  if (value === void 0) return { type: "undefined" };
  if (typeof value === "string") return { type: "string" };
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: { type: "unknown" } };
    const itemSchema = inferSchema(value[0], depth + 1);
    return { type: "array", items: itemSchema, minItems: value.length, maxItems: value.length };
  }
  if (typeof value === "object") {
    const properties = {};
    const keys = Object.keys(value);
    for (const key of keys.slice(0, 20)) {
      properties[key] = inferSchema(value[key], depth + 1);
    }
    return { type: "object", properties, required: keys.slice(0, 20) };
  }
  return { type: typeof value };
}
function checkSchema(value, schema, path, errors) {
  const type = schema.type;
  if (!type) return;
  if (type === "string" && typeof value !== "string") errors.push(`${path || "."}: expected string, got ${typeof value}`);
  else if (type === "number" && typeof value !== "number") errors.push(`${path || "."}: expected number, got ${typeof value}`);
  else if (type === "boolean" && typeof value !== "boolean") errors.push(`${path || "."}: expected boolean, got ${typeof value}`);
  else if (type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path || "."}: expected array`);
      return;
    }
    const items = schema.items;
    if (items) {
      for (let i = 0; i < Math.min(value.length, 10); i++) {
        checkSchema(value[i], items, `${path}[${i}]`, errors);
      }
    }
  } else if (type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${path || "."}: expected object`);
      return;
    }
    const properties = schema.properties;
    const required = schema.required;
    if (required) {
      for (const key of required) {
        if (!(key in value)) errors.push(`${path}.${key}: required property missing`);
      }
    }
    if (properties) {
      for (const [key, propSchema] of Object.entries(properties)) {
        if (key in value) {
          checkSchema(value[key], propSchema, `${path}.${key}`, errors);
        }
      }
    }
  }
}

// src/sandbox/async-manager.ts
var AsyncManager = class {
  tasks = /* @__PURE__ */ new Map();
  results = /* @__PURE__ */ new Map();
  counter = 0;
  maxTasks;
  constructor(maxTasks = 10) {
    this.maxTasks = maxTasks;
  }
  /**
   * Register a new background task.
   */
  register(fn, label) {
    if (this.getRunningCount() >= this.maxTasks) {
      throw new Error(`Maximum async tasks reached (${this.maxTasks})`);
    }
    const id = `async_${this.counter++}`;
    const abortController = new AbortController();
    const startTime = Date.now();
    const promise = fn(abortController.signal).then(() => {
      const task = this.tasks.get(id);
      if (task && task.status === "running") {
        task.status = "completed";
      }
    }).catch((err) => {
      const task = this.tasks.get(id);
      if (task) {
        if (task.status === "running") {
          task.status = "failed";
          task.error = err instanceof Error ? err.message : String(err);
        }
      }
    });
    this.tasks.set(id, {
      id,
      label: label ?? id,
      abortController,
      promise,
      status: "running",
      startTime
    });
    return id;
  }
  /**
   * Cancel a task by ID.
   */
  cancel(taskId, message = "cancelled by user") {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") return false;
    task.abortController.abort(message);
    task.status = "cancelled";
    this.results.set(taskId, { cancelled: true, message });
    return true;
  }
  /**
   * Store a result from a task's scoped stop() call.
   */
  setResult(taskId, value) {
    this.results.set(taskId, value);
  }
  /**
   * Drain all accumulated results and clear the results map.
   */
  drainResults() {
    const drained = new Map(this.results);
    this.results.clear();
    return drained;
  }
  /**
   * Get a task by ID.
   */
  getTask(taskId) {
    return this.tasks.get(taskId);
  }
  /**
   * Get all tasks.
   */
  getAllTasks() {
    return [...this.tasks.values()];
  }
  /**
   * Get count of currently running tasks.
   */
  getRunningCount() {
    return [...this.tasks.values()].filter((t) => t.status === "running").length;
  }
  /**
   * Build the async portion of a stop payload.
   * Running tasks show "pending", completed ones show their results.
   */
  buildStopPayload() {
    const payload = {};
    const drained = this.drainResults();
    for (const [taskId, task] of this.tasks) {
      if (drained.has(taskId)) {
        payload[task.label] = drained.get(taskId);
      } else if (task.status === "running") {
        payload[task.label] = "pending";
      }
    }
    return payload;
  }
  /**
   * Wait for all running tasks to complete, with timeout.
   */
  async drain(timeoutMs = 5e3) {
    const running = [...this.tasks.values()].filter((t) => t.status === "running");
    if (running.length === 0) return;
    await Promise.race([
      Promise.allSettled(running.map((t) => t.promise)),
      new Promise((resolve2) => setTimeout(resolve2, timeoutMs))
    ]);
  }
  /**
   * Cancel all running tasks.
   */
  cancelAll() {
    for (const task of this.tasks.values()) {
      if (task.status === "running") {
        task.abortController.abort("session cleanup");
        task.status = "cancelled";
      }
    }
  }
};

// src/stream/bracket-tracker.ts
function createBracketState() {
  return {
    round: 0,
    curly: 0,
    square: 0,
    inString: false,
    inLineComment: false,
    inBlockComment: false,
    templateDepth: 0,
    jsxDepth: 0,
    jsxTagState: "none"
  };
}
function feedChunk(state, chunk) {
  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];
    const next = chunk[i + 1];
    if (state.inLineComment) {
      if (ch === "\n") state.inLineComment = false;
      continue;
    }
    if (state.inBlockComment) {
      if (ch === "*" && next === "/") {
        state.inBlockComment = false;
        i++;
      }
      continue;
    }
    if (state.inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (state.inString === "`") {
        if (ch === "`") {
          state.inString = false;
        }
      } else if (ch === state.inString) {
        state.inString = false;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      state.inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      state.inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      state.inString = ch;
      continue;
    }
    if (state.jsxTagState === "pending_open") {
      if (/[a-zA-Z]/.test(ch)) {
        state.jsxDepth++;
        state.jsxTagState = "open";
        continue;
      } else if (ch === "/") {
        state.jsxTagState = "close";
        continue;
      } else if (ch === ">") {
        state.jsxDepth++;
        state.jsxTagState = "none";
        continue;
      } else {
        state.jsxTagState = "none";
      }
    }
    if (state.jsxTagState === "selfclose_pending") {
      if (ch === ">") {
        state.jsxDepth = Math.max(0, state.jsxDepth - 1);
        state.jsxTagState = "none";
        continue;
      }
      state.jsxTagState = "open";
    }
    if (state.jsxTagState === "open") {
      if (ch === "/") {
        state.jsxTagState = "selfclose_pending";
        continue;
      }
      if (ch === ">" && state.curly === 0 && state.round === 0 && state.square === 0) {
        state.jsxTagState = "none";
        continue;
      }
    }
    if (state.jsxTagState === "close") {
      if (ch === ">") {
        state.jsxDepth = Math.max(0, state.jsxDepth - 1);
        state.jsxTagState = "none";
      }
      continue;
    }
    if (ch === "<" && state.jsxTagState === "none") {
      state.jsxTagState = "pending_open";
      continue;
    }
    if (ch === "(") state.round++;
    else if (ch === ")") state.round = Math.max(0, state.round - 1);
    else if (ch === "{") state.curly++;
    else if (ch === "}") state.curly = Math.max(0, state.curly - 1);
    else if (ch === "[") state.square++;
    else if (ch === "]") state.square = Math.max(0, state.square - 1);
  }
  return state;
}
function isBalanced(state) {
  return state.round === 0 && state.curly === 0 && state.square === 0 && state.jsxDepth === 0 && state.jsxTagState === "none" && state.inString === false && !state.inBlockComment;
}
function resetBracketState(state) {
  state.round = 0;
  state.curly = 0;
  state.square = 0;
  state.inString = false;
  state.inLineComment = false;
  state.inBlockComment = false;
  state.templateDepth = 0;
  state.jsxDepth = 0;
  state.jsxTagState = "none";
}

// src/parser/statement-detector.ts
function isCompleteStatement(buffer) {
  const trimmed = buffer.trim();
  if (trimmed.length === 0) return false;
  let roundDepth = 0;
  let curlyDepth = 0;
  let squareDepth = 0;
  let jsxDepth = 0;
  let jsxTagState = "none";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;
  while (i < trimmed.length) {
    const ch = trimmed[i];
    const next = trimmed[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (inString === "`") {
        if (ch === "$" && next === "{") {
        }
        if (ch === "`") {
          inString = false;
        }
      } else if (ch === inString) {
        inString = false;
      }
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inString = ch;
      i++;
      continue;
    }
    if (jsxTagState === "open" && ch === "/" && next === ">") {
      jsxDepth = Math.max(0, jsxDepth - 1);
      jsxTagState = "none";
      i += 2;
      continue;
    }
    if (jsxTagState === "open" && ch === ">" && curlyDepth === 0 && roundDepth === 0 && squareDepth === 0) {
      jsxTagState = "none";
      i++;
      continue;
    }
    if (jsxTagState === "close" && ch === ">") {
      jsxDepth = Math.max(0, jsxDepth - 1);
      jsxTagState = "none";
      i++;
      continue;
    }
    if (ch === "<" && jsxTagState === "none" && next && /[a-zA-Z]/.test(next)) {
      jsxDepth++;
      jsxTagState = "open";
      i += 2;
      continue;
    }
    if (ch === "<" && jsxTagState === "none" && next === "/") {
      jsxTagState = "close";
      i += 2;
      continue;
    }
    if (ch === "<" && jsxTagState === "none" && next === ">") {
      jsxDepth++;
      i += 2;
      continue;
    }
    if (ch === "(") roundDepth++;
    else if (ch === ")") roundDepth = Math.max(0, roundDepth - 1);
    else if (ch === "{") curlyDepth++;
    else if (ch === "}") curlyDepth = Math.max(0, curlyDepth - 1);
    else if (ch === "[") squareDepth++;
    else if (ch === "]") squareDepth = Math.max(0, squareDepth - 1);
    i++;
  }
  if (inString !== false || inBlockComment) return false;
  if (roundDepth !== 0 || curlyDepth !== 0 || squareDepth !== 0) return false;
  if (jsxDepth !== 0 || jsxTagState !== "none") return false;
  return true;
}

// src/stream/line-accumulator.ts
function createLineAccumulator() {
  return {
    buffer: "",
    bracketState: createBracketState(),
    mode: "typescript",
    pendingBackticks: 0,
    fileBlockHeader: "",
    fileBlockPath: "",
    fileBlockContent: "",
    fileBlockCurrentLine: ""
  };
}
function feed(acc, token) {
  const statements = [];
  for (const char of token) {
    switch (acc.mode) {
      case "typescript": {
        if (char === "`" && acc.buffer.trimStart() === "") {
          acc.pendingBackticks++;
          if (acc.pendingBackticks === 4) {
            acc.pendingBackticks = 0;
            acc.mode = "file_block_header";
            acc.fileBlockHeader = "";
          }
        } else {
          if (acc.pendingBackticks > 0) {
            for (let i = 0; i < acc.pendingBackticks; i++) {
              acc.buffer += "`";
              feedChunk(acc.bracketState, "`");
            }
            acc.pendingBackticks = 0;
          }
          acc.buffer += char;
          feedChunk(acc.bracketState, char);
          if (char === "\n" && isBalanced(acc.bracketState)) {
            const trimmed = acc.buffer.trim();
            if (trimmed.length > 0 && isCompleteStatement(trimmed)) {
              statements.push({ type: "code", source: trimmed });
              acc.buffer = "";
              resetBracketState(acc.bracketState);
            }
          }
        }
        break;
      }
      case "file_block_header": {
        if (char === "\n") {
          const header = acc.fileBlockHeader.trim();
          if (header.startsWith("diff ")) {
            acc.mode = "file_diff";
            acc.fileBlockPath = header.slice(5).trim();
          } else {
            acc.mode = "file_write";
            acc.fileBlockPath = header;
          }
          acc.fileBlockContent = "";
          acc.fileBlockCurrentLine = "";
        } else {
          acc.fileBlockHeader += char;
        }
        break;
      }
      case "file_write":
      case "file_diff": {
        if (char === "\n") {
          if (acc.fileBlockCurrentLine === "````") {
            const path = acc.fileBlockPath;
            const rawContent = acc.fileBlockContent;
            if (acc.mode === "file_diff") {
              statements.push({ type: "file_diff", path, diff: rawContent });
            } else {
              statements.push({ type: "file_write", path, content: rawContent });
            }
            acc.mode = "typescript";
            acc.fileBlockPath = "";
            acc.fileBlockContent = "";
            acc.fileBlockCurrentLine = "";
            acc.fileBlockHeader = "";
          } else {
            acc.fileBlockContent += acc.fileBlockCurrentLine + "\n";
            acc.fileBlockCurrentLine = "";
          }
        } else {
          acc.fileBlockCurrentLine += char;
        }
        break;
      }
    }
  }
  const hasRemaining = acc.buffer.trim().length > 0 || acc.mode !== "typescript" || acc.pendingBackticks > 0;
  return { statements, hasRemaining };
}
function flush(acc) {
  if (acc.mode === "file_block_header" || acc.mode === "file_write" || acc.mode === "file_diff") {
    acc.mode = "typescript";
    acc.fileBlockPath = "";
    acc.fileBlockContent = "";
    acc.fileBlockCurrentLine = "";
    acc.fileBlockHeader = "";
    acc.pendingBackticks = 0;
    return null;
  }
  if (acc.pendingBackticks > 0) {
    for (let i = 0; i < acc.pendingBackticks; i++) {
      acc.buffer += "`";
    }
    acc.pendingBackticks = 0;
  }
  const trimmed = acc.buffer.trim();
  if (trimmed.length === 0) return null;
  acc.buffer = "";
  resetBracketState(acc.bracketState);
  return { type: "code", source: trimmed };
}
function clear(acc) {
  acc.buffer = "";
  resetBracketState(acc.bracketState);
  acc.mode = "typescript";
  acc.pendingBackticks = 0;
  acc.fileBlockHeader = "";
  acc.fileBlockPath = "";
  acc.fileBlockContent = "";
  acc.fileBlockCurrentLine = "";
}

// src/hooks/hook-executor.ts
import ts4 from "typescript";

// src/hooks/pattern-matcher.ts
import ts3 from "typescript";
function matchPattern(node, pattern, sourceFile) {
  const captures = {};
  if ("oneOf" in pattern) {
    const p = pattern;
    for (const sub of p.oneOf) {
      const match = matchPattern(node, sub, sourceFile);
      if (match) return match;
    }
    return null;
  }
  if ("not" in pattern && "type" in pattern) {
    const p = pattern;
    if (!matchNodeType(node, p.type)) return null;
    const negMatch = matchPatternProperties(node, p.not, sourceFile, captures);
    if (negMatch) return null;
    return { node, source: node.getText(sourceFile), captures };
  }
  if ("type" in pattern) {
    const p = pattern;
    if (!matchNodeType(node, p.type)) return null;
    if (!matchPatternProperties(node, p, sourceFile, captures)) return null;
    return { node, source: node.getText(sourceFile), captures };
  }
  return null;
}
function matchNodeType(node, type) {
  if (type === "*") return true;
  const syntaxKind = ts3.SyntaxKind[node.kind];
  return String(syntaxKind) === type;
}
function matchPatternProperties(node, pattern, sourceFile, captures) {
  for (const [key, expectedValue] of Object.entries(pattern)) {
    if (key === "type" || key === "oneOf" || key === "not") continue;
    const actualValue = node[key];
    if (actualValue === void 0) return false;
    if (typeof expectedValue === "object" && expectedValue !== null) {
      if (actualValue && typeof actualValue === "object" && "kind" in actualValue) {
        if (!matchPatternProperties(actualValue, expectedValue, sourceFile, captures)) {
          return false;
        }
      } else {
        return false;
      }
    } else if (typeof expectedValue === "string") {
      if (expectedValue.startsWith("$")) {
        const captureName = expectedValue.slice(1);
        if (actualValue && typeof actualValue === "object" && "kind" in actualValue) {
          captures[captureName] = actualValue.getText(sourceFile);
        } else {
          captures[captureName] = actualValue;
        }
      } else {
        if (actualValue && typeof actualValue === "object" && "kind" in actualValue) {
          if (actualValue.getText(sourceFile) !== expectedValue) return false;
        } else if (String(actualValue) !== expectedValue) {
          return false;
        }
      }
    } else {
      if (actualValue !== expectedValue) return false;
    }
  }
  return true;
}
function findMatches(sourceFile, pattern) {
  const matches = [];
  function visit(node) {
    const match = matchPattern(node, pattern, sourceFile);
    if (match) matches.push(match);
    ts3.forEachChild(node, visit);
  }
  visit(sourceFile);
  return matches;
}

// src/hooks/hook-executor.ts
async function executeHooks(source, phase, registry, context) {
  const hooks = registry.listByPhase(phase);
  const result = {
    action: "execute",
    source,
    sideEffects: [],
    matchedHooks: []
  };
  if (hooks.length === 0) return result;
  const sourceFile = ts4.createSourceFile(
    "hook.ts",
    source,
    ts4.ScriptTarget.ESNext,
    true,
    ts4.ScriptKind.TSX
  );
  for (const hook of hooks) {
    const matches = findMatches(sourceFile, hook.pattern);
    if (matches.length === 0) continue;
    for (const match of matches) {
      let action;
      try {
        action = await hook.handler(match, context);
        registry.recordSuccess(hook.id);
      } catch (err) {
        registry.recordFailure(hook.id);
        continue;
      }
      result.matchedHooks.push({ hookId: hook.id, action: action.type });
      switch (action.type) {
        case "continue":
          break;
        case "side_effect":
          result.sideEffects.push(action.fn);
          break;
        case "transform":
          if (phase === "before") {
            result.source = action.newSource;
          }
          break;
        case "interrupt":
          if (phase === "before") {
            result.action = "interrupt";
            result.interruptMessage = action.message;
            return result;
          }
          break;
        case "skip":
          if (phase === "before") {
            result.action = "skip";
            return result;
          }
          break;
      }
    }
  }
  return result;
}

// src/stream/stream-controller.ts
var StreamController = class {
  accumulator = createLineAccumulator();
  paused = false;
  pauseResolve = null;
  options;
  lineCount = 0;
  currentBlockId = "";
  constructor(options) {
    this.options = options;
  }
  /**
   * Feed tokens from the LLM stream.
   */
  async feedToken(token) {
    if (this.paused) {
      await this.waitForResume();
    }
    const { statements } = feed(this.accumulator, token);
    if (token.length > 0) {
      this.options.onEvent({
        type: "code",
        lines: token,
        blockId: this.currentBlockId || this.newBlockId()
      });
    }
    for (const statement of statements) {
      await this.processStatement(statement);
      if (this.paused) {
        await this.waitForResume();
      }
    }
  }
  /**
   * Called when the LLM stream ends. Flush remaining buffer.
   */
  async finalize() {
    const remaining = flush(this.accumulator);
    if (remaining) {
      await this.processStatement(remaining);
    }
  }
  async processStatement(stmt) {
    this.lineCount++;
    if (stmt.type === "file_write" || stmt.type === "file_diff") {
      const header = stmt.type === "file_diff" ? `\`\`\`\`diff ${stmt.path}` : `\`\`\`\`${stmt.path}`;
      this.options.onCodeLine(header);
      if (this.options.onFileBlock) {
        await this.options.onFileBlock(stmt);
      }
      return;
    }
    const source = stmt.source;
    const ctx = this.options.hookContext();
    const hookResult = await executeHooks(
      source,
      "before",
      this.options.hookRegistry,
      ctx
    );
    for (const fn of hookResult.sideEffects) {
      try {
        await fn();
      } catch {
      }
    }
    for (const match of hookResult.matchedHooks) {
      this.options.onEvent({
        type: "hook",
        hookId: match.hookId,
        action: match.action,
        detail: source,
        blockId: this.currentBlockId
      });
    }
    if (hookResult.action === "skip") {
      return;
    }
    if (hookResult.action === "interrupt") {
      this.options.onEvent({
        type: "hook",
        hookId: hookResult.matchedHooks[hookResult.matchedHooks.length - 1]?.hookId ?? "unknown",
        action: "interrupt",
        detail: hookResult.interruptMessage ?? "",
        blockId: this.currentBlockId
      });
      return;
    }
    const finalSource = hookResult.source;
    this.options.onCodeLine(finalSource);
    const result = await this.options.onStatement(finalSource);
    await executeHooks(finalSource, "after", this.options.hookRegistry, ctx);
    if (!result.ok && result.error) {
      this.options.onError(result.error);
      this.options.onEvent({
        type: "error",
        error: result.error,
        blockId: this.currentBlockId
      });
    }
  }
  // ── StreamPauseController interface ──
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    if (this.pauseResolve) {
      const resolve2 = this.pauseResolve;
      this.pauseResolve = null;
      resolve2();
    }
  }
  isPaused() {
    return this.paused;
  }
  waitForResume() {
    if (!this.paused) return Promise.resolve();
    return new Promise((resolve2) => {
      this.pauseResolve = resolve2;
    });
  }
  /**
   * Clear the line accumulator (e.g., on intervention).
   */
  clearBuffer() {
    clear(this.accumulator);
  }
  /**
   * Set the current block ID for events.
   */
  setBlockId(id) {
    this.currentBlockId = id;
  }
  newBlockId() {
    this.currentBlockId = `block_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    return this.currentBlockId;
  }
};

// src/hooks/hook-registry.ts
var HookRegistry = class {
  hooks = /* @__PURE__ */ new Map();
  failureCounts = /* @__PURE__ */ new Map();
  disabledHooks = /* @__PURE__ */ new Set();
  maxConsecutiveFailures;
  constructor(maxConsecutiveFailures = 3) {
    this.maxConsecutiveFailures = maxConsecutiveFailures;
  }
  register(hook) {
    this.hooks.set(hook.id, hook);
    this.failureCounts.set(hook.id, 0);
  }
  unregister(id) {
    this.failureCounts.delete(id);
    this.disabledHooks.delete(id);
    return this.hooks.delete(id);
  }
  get(id) {
    return this.hooks.get(id);
  }
  /**
   * List hooks by phase, excluding disabled hooks.
   */
  listByPhase(phase) {
    return [...this.hooks.values()].filter(
      (h) => h.phase === phase && !this.disabledHooks.has(h.id)
    );
  }
  /**
   * Record a failure for a hook. After maxConsecutiveFailures, disable it.
   */
  recordFailure(id) {
    const count = (this.failureCounts.get(id) ?? 0) + 1;
    this.failureCounts.set(id, count);
    if (count >= this.maxConsecutiveFailures) {
      this.disabledHooks.add(id);
    }
  }
  /**
   * Record a success for a hook (resets failure count).
   */
  recordSuccess(id) {
    this.failureCounts.set(id, 0);
  }
  isDisabled(id) {
    return this.disabledHooks.has(id);
  }
  getAll() {
    return [...this.hooks.values()];
  }
  clear() {
    this.hooks.clear();
    this.failureCounts.clear();
    this.disabledHooks.clear();
  }
};

// src/context/scope-generator.ts
function generateScopeTable(entries, options = {}) {
  const { maxVariables = 50, maxValueWidth = 50 } = options;
  const visible = entries.slice(0, maxVariables);
  if (visible.length === 0) {
    return "(no variables declared)";
  }
  const nameCol = Math.max(4, ...visible.map((e) => e.name.length));
  const typeCol = Math.max(4, ...visible.map((e) => e.type.length));
  const header = `${"Name".padEnd(nameCol)}  ${"Type".padEnd(typeCol)}  Value`;
  const separator = `${"-".repeat(nameCol)}  ${"-".repeat(typeCol)}  ${"-".repeat(maxValueWidth)}`;
  const rows = visible.map((e) => {
    const truncatedValue = e.value.length > maxValueWidth ? e.value.slice(0, maxValueWidth - 3) + "..." : e.value;
    return `${e.name.padEnd(nameCol)}  ${e.type.padEnd(typeCol)}  ${truncatedValue}`;
  });
  const lines = [header, separator, ...rows];
  if (entries.length > maxVariables) {
    lines.push(`... +${entries.length - maxVariables} more variables`);
  }
  return lines.join("\n");
}
function describeType2(val) {
  if (val === null) return "null";
  if (val === void 0) return "undefined";
  if (Array.isArray(val)) {
    if (val.length === 0) return "Array";
    return `Array<${describeType2(val[0])}>`;
  }
  const t = typeof val;
  if (t === "object") {
    const name = val.constructor?.name;
    return name && name !== "Object" ? name : "Object";
  }
  return t;
}
function truncateValue2(val, maxLen = 50) {
  if (val === null) return "null";
  if (val === void 0) return "undefined";
  if (typeof val === "function") return `[Function: ${val.name || "anonymous"}]`;
  if (typeof val === "symbol") return val.toString();
  try {
    let str;
    if (typeof val === "string") {
      str = JSON.stringify(val);
    } else if (Array.isArray(val)) {
      const preview = val.slice(0, 3).map((v) => truncateValue2(v, 20)).join(", ");
      str = val.length > 3 ? `[${preview}, ... +${val.length - 3}]` : `[${preview}]`;
    } else if (typeof val === "object") {
      const keys = Object.keys(val);
      const preview = keys.slice(0, 5).join(", ");
      str = keys.length > 5 ? `{${preview}, ... +${keys.length - 5}}` : `{${preview}}`;
    } else {
      str = String(val);
    }
    if (str.length > maxLen) {
      return str.slice(0, maxLen - 3) + "...";
    }
    return str;
  } catch {
    return "[value]";
  }
}

// src/context/message-builder.ts
function buildStopMessage(payload) {
  const entries = Object.entries(payload).map(([key, sv]) => `${key}: ${sv.display}`).join(", ");
  return `\u2190 stop { ${entries} }`;
}
function buildErrorMessage(error) {
  return `\u2190 error [${error.type}] ${error.message} (line ${error.line})`;
}
function buildInterventionMessage(text) {
  return text;
}
function buildHookInterruptMessage(hookId, message) {
  return `\u26A0 [hook:${hookId}] ${message}`;
}
function buildTasklistReminderMessage(tasklistId, ready, blocked, failed) {
  let msg = `\u26A0 [system] Tasklist "${tasklistId}" incomplete.`;
  if (ready.length > 0) msg += ` Ready: ${ready.join(", ")}.`;
  if (blocked.length > 0) msg += ` Blocked: ${blocked.join(", ")}.`;
  if (failed.length > 0) msg += ` Failed: ${failed.join(", ")}.`;
  msg += " Continue with a ready task.";
  return msg;
}
function renderTaskLine(task, state) {
  const completion = state.completed.get(task.id);
  if (completion?.status === "completed") {
    const outputStr = JSON.stringify(completion.output);
    const truncated = outputStr.length > 40 ? outputStr.slice(0, 37) + "..." : outputStr;
    return { symbol: "\u2713", detail: `\u2192 ${truncated}` };
  }
  if (completion?.status === "failed") {
    return { symbol: "\u2717", detail: `\u2014 ${completion.error ?? "unknown error"}` };
  }
  if (completion?.status === "skipped") {
    return { symbol: "\u2298", detail: "(skipped \u2014 condition was falsy)" };
  }
  if (state.runningTasks.has(task.id)) {
    const progress = state.progressMessages?.get(task.id);
    const detail = progress ? `(running \u2014 ${progress.percent != null ? progress.percent + "% " : ""}${progress.message})` : "(running)";
    return { symbol: "\u25C9", detail };
  }
  if (state.readyTasks.has(task.id)) {
    return { symbol: "\u25CE", detail: "(ready \u2014 deps satisfied)" };
  }
  const deps = task.dependsOn?.join(", ") ?? "";
  return { symbol: "\u25CB", detail: deps ? `(blocked \u2014 waiting on: ${deps})` : "(pending)" };
}
function buildTaskContinueMessage(tasklistId, completedTaskId, readyTasks, tasklistsState) {
  let msg = `\u2190 completeTask \u2713 ${tasklistId}/${completedTaskId}`;
  if (readyTasks.length > 0) {
    msg += `

Next task:`;
    const next = readyTasks[0];
    msg += `
  Task: ${next.id}`;
    msg += `
  Instructions: ${next.instructions}`;
    const schemaStr = Object.entries(next.outputSchema).map(([k, v]) => `${k}: ${v.type}`).join(", ");
    msg += `
  Expected output: { ${schemaStr} }`;
    if (readyTasks.length > 1) {
      msg += `

Also ready: ${readyTasks.slice(1).map((t) => t.id).join(", ")}`;
    }
  }
  const tasksBlock = generateTasksBlock(tasklistsState);
  if (tasksBlock) msg += `

${tasksBlock}`;
  return msg;
}
function buildTaskOrderViolationMessage(tasklistId, attemptedTaskId, readyTasks, tasklistsState) {
  let msg = `\u26A0 [system] Task order violation in tasklist "${tasklistId}": tried to complete "${attemptedTaskId}" but it is not ready.`;
  if (readyTasks.length > 0) {
    msg += `

Next task to complete:`;
    const next = readyTasks[0];
    msg += `
  Task: ${next.id}`;
    msg += `
  Instructions: ${next.instructions}`;
    const schemaStr = Object.entries(next.outputSchema).map(([k, v]) => `${k}: ${v.type}`).join(", ");
    msg += `
  Expected output: { ${schemaStr} }`;
    if (readyTasks.length > 1) {
      msg += `

Also ready: ${readyTasks.slice(1).map((t) => t.id).join(", ")}`;
    }
  }
  msg += "\n\nWork on the ready task above, then call completeTask() when done.";
  const tasksBlock = generateTasksBlock(tasklistsState);
  if (tasksBlock) msg += `

${tasksBlock}`;
  return msg;
}
function generateCurrentTaskBlock(tasklistsState) {
  if (tasklistsState.tasklists.size === 0) return null;
  const lines = [];
  for (const [tasklistId, state] of tasklistsState.tasklists) {
    const readyIds = [...state.readyTasks];
    if (readyIds.length === 0) continue;
    const next = state.plan.tasks.find((t) => t.id === readyIds[0]);
    if (!next) continue;
    lines.push(`{{CURRENT_TASK}}`);
    lines.push(`Tasklist: ${tasklistId}`);
    lines.push(`Task: ${next.id}`);
    lines.push(`Instructions: ${next.instructions}`);
    const schemaStr = Object.entries(next.outputSchema).map(([k, v]) => `${k}: ${v.type}`).join(", ");
    lines.push(`Expected output: { ${schemaStr} }`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
function generateTasksBlock(tasklistsState) {
  if (tasklistsState.tasklists.size === 0) return null;
  const lines = ["{{TASKS}}"];
  for (const [tasklistId, state] of tasklistsState.tasklists) {
    const width = Math.max(1, 60 - tasklistId.length - 3);
    lines.push(`\u250C ${tasklistId} ${"\u2500".repeat(width)}\u2510`);
    for (const task of state.plan.tasks) {
      const { symbol, detail } = renderTaskLine(task, state);
      lines.push(`\u2502 ${symbol} ${task.id.padEnd(18)} ${detail.padEnd(40)}\u2502`);
    }
    lines.push(`\u2514${"\u2500".repeat(63)}\u2518`);
  }
  return lines.join("\n");
}

// src/sandbox/agent-registry.ts
var AgentRegistry = class {
  entries = /* @__PURE__ */ new Map();
  questionResolvers = /* @__PURE__ */ new Map();
  currentTurn = 0;
  config;
  constructor(config = {}) {
    this.config = config;
  }
  register(varName, promise, label, childSession) {
    const entry = {
      varName,
      label,
      status: "running",
      promise,
      childSession,
      registeredAt: Date.now(),
      registeredTurn: this.currentTurn,
      pendingQuestion: null
    };
    this.entries.set(varName, entry);
    promise.then(
      (value) => this.resolve(varName, value),
      (err) => {
        const error = err instanceof Error ? err.message : String(err);
        this.fail(varName, error);
      }
    );
    this.config.onRegistered?.(varName, label);
  }
  resolve(varName, value) {
    const entry = this.entries.get(varName);
    if (!entry) return;
    entry.status = "resolved";
    entry.resolvedValue = value;
    entry.completedAt = Date.now();
    this.config.onResolved?.(varName);
  }
  fail(varName, error) {
    const entry = this.entries.get(varName);
    if (!entry) return;
    entry.status = "failed";
    entry.error = error;
    entry.completedAt = Date.now();
    this.config.onFailed?.(varName, error);
  }
  getAll() {
    return [...this.entries.values()];
  }
  getPending() {
    return [...this.entries.values()].filter(
      (e) => e.status === "running" || e.status === "waiting"
    );
  }
  getSnapshot(varName) {
    const entry = this.entries.get(varName);
    if (!entry) return null;
    let tasklistsState = null;
    if (entry.childSession) {
      try {
        tasklistsState = entry.childSession.snapshot().tasklistsState;
      } catch {
      }
    }
    return {
      varName: entry.varName,
      label: entry.label,
      status: entry.status,
      tasklistsState,
      pendingQuestion: entry.pendingQuestion ?? null,
      error: entry.error
    };
  }
  getAllSnapshots() {
    return [...this.entries.keys()].map((varName) => this.getSnapshot(varName)).filter(Boolean);
  }
  findByPromise(promise) {
    for (const entry of this.entries.values()) {
      if (entry.promise === promise) return entry;
    }
    return null;
  }
  advanceTurn() {
    this.currentTurn++;
  }
  getCurrentTurn() {
    return this.currentTurn;
  }
  hasEntries() {
    return this.entries.size > 0;
  }
  hasVisibleEntries() {
    for (const entry of this.entries.values()) {
      if (entry.status === "running" || entry.status === "waiting") return true;
      if (entry.completedAt != null) {
        const turnsSinceCompletion = this.currentTurn - entry.registeredTurn;
        if (turnsSinceCompletion <= 5) return true;
      }
    }
    return false;
  }
  /**
   * Low-level setter — updates entry status and question fields.
   * Prefer askQuestion() for the full flow (sets question + returns Promise).
   */
  setPendingQuestion(varName, question) {
    const entry = this.entries.get(varName);
    if (!entry) throw new Error(`setPendingQuestion: unknown agent "${varName}"`);
    entry.pendingQuestion = question;
    entry.status = "waiting";
  }
  /**
   * Ask a question on behalf of a child agent. Sets status to 'waiting',
   * stores the question, and returns a Promise that resolves when the
   * parent calls respond().
   */
  askQuestion(varName, question) {
    const entry = this.entries.get(varName);
    if (!entry) throw new Error(`askQuestion: unknown agent "${varName}"`);
    entry.pendingQuestion = question;
    entry.status = "waiting";
    this.config.onQuestionAsked?.(varName, question);
    return new Promise((resolve2) => {
      this.questionResolvers.set(varName, resolve2);
    });
  }
  /**
   * Deliver structured input to a child agent's pending askParent() call.
   * Resolves the Promise returned by askQuestion(), clears the pending
   * question, and sets the agent back to 'running'.
   */
  respond(varName, data) {
    const entry = this.entries.get(varName);
    if (!entry) throw new Error(`respond: unknown agent "${varName}"`);
    if (entry.status !== "waiting") {
      throw new Error(`respond: agent "${varName}" is not waiting for input (status: ${entry.status})`);
    }
    const resolver = this.questionResolvers.get(varName);
    if (!resolver) throw new Error(`respond: no pending question for agent "${varName}"`);
    entry.pendingQuestion = null;
    entry.status = "running";
    this.questionResolvers.delete(varName);
    resolver(data);
    this.config.onQuestionAnswered?.(varName);
  }
  destroy() {
    this.entries.clear();
    this.questionResolvers.clear();
  }
};

// src/context/agents-block.ts
function generateAgentsBlock(registry, resolvedInThisStop) {
  if (!registry.hasVisibleEntries()) return null;
  const currentTurn = registry.getCurrentTurn();
  const lines = ["{{AGENTS}}"];
  for (const entry of registry.getAll()) {
    const turnsSinceRegistered = currentTurn - entry.registeredTurn;
    const completedTurnDistance = entry.completedAt != null ? currentTurn - entry.registeredTurn : 0;
    if ((entry.status === "resolved" || entry.status === "failed") && completedTurnDistance >= 6) {
      continue;
    }
    const width = Math.max(1, 60 - entry.varName.length - entry.label.length - 5);
    lines.push(`\u250C ${entry.varName} \u2014 ${entry.label} ${"\u2500".repeat(width)}\u2510`);
    const isCompact = (entry.status === "resolved" || entry.status === "failed") && completedTurnDistance >= 3;
    if (entry.status === "running") {
      lines.push(`\u2502 \u25C9 running${" ".repeat(52)}\u2502`);
      const snapshot = registry.getSnapshot(entry.varName);
      if (snapshot?.tasklistsState && snapshot.tasklistsState.tasklists.size > 0) {
        for (const [tlId, tlState] of snapshot.tasklistsState.tasklists) {
          const tlWidth = Math.max(1, 56 - tlId.length - 3);
          lines.push(`\u2502 \u250C tasks ${"\u2500".repeat(tlWidth)}\u2510  \u2502`);
          for (const task of tlState.plan.tasks) {
            const { symbol, detail } = renderTaskLine(task, tlState);
            lines.push(`\u2502 \u2502 ${symbol} ${task.id.padEnd(16)} ${detail.padEnd(36)}\u2502  \u2502`);
          }
          lines.push(`\u2502 \u2514${"\u2500".repeat(Math.max(1, 57))}\u2518  \u2502`);
        }
      } else {
        lines.push(`\u2502 (no tasklist)${" ".repeat(48)}\u2502`);
      }
    } else if (entry.status === "waiting") {
      lines.push(`\u2502 ? waiting \u2014 needs input from parent${" ".repeat(26)}\u2502`);
      if (entry.pendingQuestion && !isCompact) {
        lines.push(`\u2502 \u250C question \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510   \u2502`);
        const msg = entry.pendingQuestion.message.slice(0, 50);
        lines.push(`\u2502 \u2502 "${msg}"${" ".repeat(Math.max(1, 51 - msg.length))}\u2502   \u2502`);
        const schemaEntries = Object.entries(entry.pendingQuestion.schema);
        if (schemaEntries.length > 0) {
          lines.push(`\u2502 \u2502 schema: {${" ".repeat(43)}\u2502   \u2502`);
          for (const [key, val] of schemaEntries.slice(0, 5)) {
            const typeStr = formatSchemaValue(val);
            lines.push(`\u2502 \u2502   ${key}: ${typeStr}`.padEnd(56) + "\u2502   \u2502");
          }
          if (schemaEntries.length > 5) {
            lines.push(`\u2502 \u2502   ... +${schemaEntries.length - 5} more`.padEnd(56) + "\u2502   \u2502");
          }
          lines.push(`\u2502 \u2502 }`.padEnd(56) + "\u2502   \u2502");
        }
        lines.push(`\u2502 \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518   \u2502`);
      }
    } else if (entry.status === "resolved") {
      if (isCompact) {
        lines.push(`\u2502 \u2713 resolved${" ".repeat(51)}\u2502`);
      } else if (resolvedInThisStop.has(entry.varName)) {
        lines.push(`\u2502 \u2713 (value included in this stop payload)${" ".repeat(22)}\u2502`);
      } else {
        lines.push(`\u2502 \u2713 resolved${" ".repeat(51)}\u2502`);
      }
    } else if (entry.status === "failed") {
      if (isCompact) {
        lines.push(`\u2502 \u2717 failed${" ".repeat(53)}\u2502`);
      } else {
        const errMsg = (entry.error ?? "unknown error").slice(0, 50);
        lines.push(`\u2502 \u2717 ${errMsg.padEnd(59)}\u2502`);
      }
    }
    lines.push(`\u2514${"\u2500".repeat(63)}\u2518`);
  }
  if (lines.length === 1) return null;
  return lines.join("\n");
}
function formatSchemaValue(val) {
  if (!val || typeof val !== "object") return String(val);
  const obj = val;
  if (Array.isArray(obj.enum)) {
    return obj.enum.slice(0, 4).map((e) => `"${e}"`).join(" | ") + (obj.enum.length > 4 ? ` | ...` : "");
  }
  if (typeof obj.type === "string") return obj.type;
  return JSON.stringify(val).slice(0, 30);
}

// src/session/conversation-state.ts
function computeScopeDelta(previous, current) {
  const prevMap = /* @__PURE__ */ new Map();
  for (const entry of previous) prevMap.set(entry.name, entry);
  const currMap = /* @__PURE__ */ new Map();
  for (const entry of current) currMap.set(entry.name, entry);
  const added = [];
  const changed = [];
  for (const entry of current) {
    const prev = prevMap.get(entry.name);
    if (!prev) {
      added.push(entry);
    } else if (prev.type !== entry.type || prev.value !== entry.value) {
      changed.push({
        ...entry,
        previousValue: prev.value,
        previousType: prev.type
      });
    }
  }
  const removed = [];
  for (const entry of previous) {
    if (!currMap.has(entry.name)) {
      removed.push(entry.name);
    }
  }
  return { added, changed, removed };
}
function serializeTasklistsState(state) {
  const tasklists = {};
  for (const [id, tl] of state.tasklists) {
    tasklists[id] = {
      plan: {
        tasklistId: tl.plan.tasklistId,
        description: tl.plan.description,
        tasks: tl.plan.tasks
      },
      completed: Object.fromEntries(tl.completed),
      readyTasks: [...tl.readyTasks],
      runningTasks: [...tl.runningTasks],
      outputs: Object.fromEntries(tl.outputs),
      progressMessages: Object.fromEntries(tl.progressMessages),
      retryCount: Object.fromEntries(tl.retryCount)
    };
  }
  return { tasklists };
}
var ConversationRecorder = class {
  state;
  previousScope = [];
  pendingEvents = [];
  currentTurnStartedAt;
  constructor() {
    const now = Date.now();
    this.state = {
      startedAt: now,
      turns: [],
      tasklists: { tasklists: {} },
      stopCount: 0,
      status: "idle"
    };
    this.currentTurnStartedAt = now;
  }
  /** Record an assistant turn ending at a stop boundary. */
  recordStop(code, payload, scope, tasklists) {
    const stopPayload = {};
    for (const [key, sv] of Object.entries(payload)) {
      stopPayload[key] = { display: sv.display, type: typeof sv.value };
    }
    this.state.stopCount++;
    this.pushTurn({
      role: "assistant",
      code,
      message: null,
      boundary: { type: "stop", payload: stopPayload },
      scope
    });
    this.state.tasklists = serializeTasklistsState(tasklists);
  }
  /** Record an assistant turn ending at an error boundary. */
  recordError(code, error, scope) {
    this.pushTurn({
      role: "assistant",
      code,
      message: null,
      boundary: {
        type: "error",
        error: {
          type: error.type,
          message: error.message,
          line: error.line,
          source: error.source
        }
      },
      scope
    });
  }
  /** Record an assistant turn ending at an intervention boundary. */
  recordIntervention(code, text, scope) {
    this.pushTurn({
      role: "assistant",
      code,
      message: null,
      boundary: { type: "intervention", text },
      scope
    });
  }
  /** Record an assistant turn ending at a tasklist reminder boundary. */
  recordTasklistReminder(code, tasklistId, ready, blocked, failed, scope, tasklists) {
    this.pushTurn({
      role: "assistant",
      code,
      message: null,
      boundary: { type: "tasklist_reminder", tasklistId, ready, blocked, failed },
      scope
    });
    this.state.tasklists = serializeTasklistsState(tasklists);
  }
  /** Record session completion. */
  recordCompletion(code, scope, tasklists, status) {
    this.pushTurn({
      role: "assistant",
      code,
      message: null,
      boundary: { type: "completion" },
      scope
    });
    this.state.tasklists = serializeTasklistsState(tasklists);
    this.state.status = status;
  }
  /** Record a user message turn. */
  recordUserMessage(text, scope) {
    this.pushTurn({
      role: "user",
      code: null,
      message: text,
      boundary: null,
      scope
    });
  }
  /** Accumulate a session event (filtered to TurnEvent subset). */
  recordEvent(event) {
    const turnEvent = toTurnEvent(event);
    if (turnEvent) this.pendingEvents.push(turnEvent);
    if (event.type === "status") {
      this.state.status = event.status;
    }
  }
  /** Update session status. */
  updateStatus(status) {
    this.state.status = status;
  }
  /** Get the current full conversation state (returns a shallow copy). */
  getState() {
    return {
      ...this.state,
      turns: [...this.state.turns]
    };
  }
  pushTurn(opts) {
    const now = Date.now();
    const scopeSnapshot = [...opts.scope];
    const scopeDelta = this.state.turns.length > 0 ? computeScopeDelta(this.previousScope, opts.scope) : opts.scope.length > 0 ? { added: [...opts.scope], changed: [], removed: [] } : null;
    this.state.turns.push({
      index: this.state.turns.length,
      startedAt: this.currentTurnStartedAt,
      endedAt: now,
      role: opts.role,
      code: opts.code ? [...opts.code] : null,
      message: opts.message,
      boundary: opts.boundary,
      scopeSnapshot,
      scopeDelta,
      events: this.pendingEvents.splice(0)
    });
    this.previousScope = scopeSnapshot;
    this.currentTurnStartedAt = now;
  }
};
function toTurnEvent(event) {
  switch (event.type) {
    case "display":
      return { type: "display", componentId: event.componentId };
    case "ask_start":
      return { type: "ask_start", formId: event.formId };
    case "ask_end":
      return { type: "ask_end", formId: event.formId };
    case "async_start":
      return { type: "async_start", taskId: event.taskId, label: event.label };
    case "async_complete":
      return { type: "async_complete", taskId: event.taskId };
    case "async_failed":
      return { type: "async_failed", taskId: event.taskId, error: event.error };
    case "async_cancelled":
      return { type: "async_cancelled", taskId: event.taskId };
    case "tasklist_declared":
      return {
        type: "tasklist_declared",
        tasklistId: event.tasklistId,
        description: event.plan.description,
        taskCount: event.plan.tasks.length
      };
    case "task_complete":
      return { type: "task_complete", tasklistId: event.tasklistId, taskId: event.id };
    case "task_failed":
      return { type: "task_failed", tasklistId: event.tasklistId, taskId: event.id, error: event.error };
    case "task_retried":
      return { type: "task_retried", tasklistId: event.tasklistId, taskId: event.id };
    case "task_skipped":
      return { type: "task_skipped", tasklistId: event.tasklistId, taskId: event.id, reason: event.reason };
    case "task_progress":
      return { type: "task_progress", tasklistId: event.tasklistId, taskId: event.id, message: event.message, percent: event.percent };
    case "knowledge_loaded":
      return { type: "knowledge_loaded", domains: event.domains };
    case "class_loaded":
      return { type: "class_loaded", className: event.className, methods: event.methods };
    case "hook":
      return { type: "hook", hookId: event.hookId, action: event.action };
    case "agent_registered":
      return { type: "agent_registered", varName: event.varName, label: event.label };
    case "agent_resolved":
      return { type: "agent_resolved", varName: event.varName };
    case "agent_failed":
      return { type: "agent_failed", varName: event.varName, error: event.error };
    default:
      return null;
  }
}

// src/stream/file-block-applier.ts
import * as nodeFs from "fs/promises";
import * as nodePath from "path";
function makeSafePath(workingDir) {
  return (p) => {
    const resolved = nodePath.resolve(workingDir, p);
    if (!resolved.startsWith(workingDir + nodePath.sep) && resolved !== workingDir) {
      throw new Error(`Path traversal blocked: ${p} resolves outside working directory`);
    }
    return resolved;
  };
}
function parseHunks(diffContent) {
  const lines = diffContent.split("\n");
  const hunks = [];
  let i = 0;
  while (i < lines.length && !lines[i].startsWith("@@")) i++;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith("@@")) {
      i++;
      continue;
    }
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) {
      i++;
      continue;
    }
    const oldStart = parseInt(match[1], 10);
    const oldCount = match[2] !== void 0 ? parseInt(match[2], 10) : 1;
    const newStart = parseInt(match[3], 10);
    const newCount = match[4] !== void 0 ? parseInt(match[4], 10) : 1;
    i++;
    const hunkLines = [];
    while (i < lines.length && !lines[i].startsWith("@@")) {
      const l = lines[i];
      if (l.startsWith("-")) {
        hunkLines.push({ op: "-", text: l.slice(1) });
      } else if (l.startsWith("+")) {
        hunkLines.push({ op: "+", text: l.slice(1) });
      } else if (l.startsWith(" ")) {
        hunkLines.push({ op: " ", text: l.slice(1) });
      } else if (l.startsWith("\\")) {
      } else if (l === "" || l.startsWith("diff ") || l.startsWith("---") || l.startsWith("+++")) {
        break;
      }
      i++;
    }
    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }
  return hunks;
}
function applyHunksToContent(fileContent, hunks) {
  const hadTrailingNewline = fileContent.endsWith("\n");
  const fileLines = fileContent.split("\n");
  if (hadTrailingNewline && fileLines[fileLines.length - 1] === "") {
    fileLines.pop();
  }
  const result = [...fileLines];
  let offset = 0;
  for (const hunk of hunks) {
    const startIdx = hunk.oldStart - 1 + offset;
    const expectedOldLines = hunk.lines.filter((l) => l.op === " " || l.op === "-").map((l) => l.text);
    for (let j = 0; j < expectedOldLines.length; j++) {
      const fileIdx = startIdx + j;
      const fileLine = result[fileIdx];
      if (fileLine !== expectedOldLines[j]) {
        return {
          ok: false,
          error: `Hunk @@ -${hunk.oldStart},${hunk.oldCount} @@: context mismatch at line ${hunk.oldStart + j}. Expected ${JSON.stringify(expectedOldLines[j])}, got ${fileLine === void 0 ? "<EOF>" : JSON.stringify(fileLine)}`
        };
      }
    }
    const newLines = hunk.lines.filter((l) => l.op === " " || l.op === "+").map((l) => l.text);
    result.splice(startIdx, expectedOldLines.length, ...newLines);
    offset += newLines.length - expectedOldLines.length;
  }
  const content = result.join("\n") + (hadTrailingNewline ? "\n" : "");
  return { ok: true, content };
}
async function applyFileWrite(filePath, content, options) {
  const { workingDir, ledger, gitClient, autoCommit = true } = options;
  const safePath = makeSafePath(workingDir);
  let resolved;
  try {
    resolved = safePath(filePath);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  await nodeFs.mkdir(nodePath.dirname(resolved), { recursive: true });
  await nodeFs.writeFile(resolved, content, "utf-8");
  recordRead(ledger, resolved);
  if (gitClient && autoCommit) {
    const commitResult = await gitClient.commitFile(
      filePath,
      `Create/update ${filePath}`
    );
    if (commitResult.ok) {
      return { ok: true, commitHash: commitResult.hash };
    }
  }
  return { ok: true };
}
async function applyFileDiff(filePath, diffContent, options) {
  const { workingDir, ledger, gitClient, autoCommit = true } = options;
  const safePath = makeSafePath(workingDir);
  let resolved;
  try {
    resolved = safePath(filePath);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  if (!hasBeenRead(ledger, resolved)) {
    return {
      ok: false,
      error: `File '${filePath}' has not been read this session. Call readFile('${filePath}') before patching.`
    };
  }
  let existing;
  try {
    existing = await nodeFs.readFile(resolved, "utf-8");
  } catch {
    return { ok: false, error: `Cannot read '${filePath}': file does not exist or is not readable.` };
  }
  const hunks = parseHunks(diffContent);
  if (hunks.length === 0) {
    return { ok: false, error: `No valid hunks found in diff for '${filePath}'.` };
  }
  const result = applyHunksToContent(existing, hunks);
  if (!result.ok) {
    return result;
  }
  await nodeFs.writeFile(resolved, result.content, "utf-8");
  if (gitClient && autoCommit) {
    const commitResult = await gitClient.commitFile(
      filePath,
      `Patch ${filePath}`
    );
    if (commitResult.ok) {
      return { ok: true, commitHash: commitResult.hash };
    }
  }
  return { ok: true };
}

// src/session/session.ts
var Session = class extends EventEmitter {
  status = "idle";
  config;
  sandbox;
  asyncManager;
  hookRegistry;
  streamController;
  globalsApi;
  blocks = [];
  codeLines = [];
  messages = [];
  activeFormId = null;
  stopCount = 0;
  tasklistReminderCount = 0;
  agentRegistry;
  recorder;
  turnCodeStart = 0;
  onSpawn;
  readLedger;
  fileWorkingDir;
  vectorIndex = new VectorIndex();
  currentTurn = 0;
  options;
  constructor(options = {}) {
    super();
    this.options = options;
    this.config = options.config ? mergeConfig(options.config) : createDefaultConfig();
    this.readLedger = createReadLedger();
    this.fileWorkingDir = options.fileWorkingDir ?? process.cwd();
    this.asyncManager = new AsyncManager(this.config.maxAsyncTasks);
    this.hookRegistry = new HookRegistry();
    this.agentRegistry = new AgentRegistry({
      onRegistered: (varName, label) => {
        this.emitEvent({ type: "agent_registered", varName, label });
      },
      onResolved: (varName) => {
        this.emitEvent({ type: "agent_resolved", varName });
      },
      onFailed: (varName, error) => {
        this.emitEvent({ type: "agent_failed", varName, error });
      },
      onQuestionAsked: (varName, question) => {
        this.emitEvent({ type: "agent_question_asked", varName, question });
      },
      onQuestionAnswered: (varName) => {
        this.emitEvent({ type: "agent_question_answered", varName });
      }
    });
    if (options.hooks) {
      for (const hook of options.hooks) {
        this.hookRegistry.register(hook);
      }
    }
    this.sandbox = new Sandbox({
      timeout: this.config.functionTimeout,
      globals: options.globals
    });
    this.streamController = new StreamController({
      onStatement: (source) => this.executeStatement(source),
      onStop: (payload, source) => this.handleStop(payload, source),
      onError: (error) => this.handleError(error),
      onEvent: (event) => this.emitEvent(event),
      onCodeLine: (line) => this.codeLines.push(line),
      hookRegistry: this.hookRegistry,
      hookContext: () => ({
        lineNumber: this.sandbox.getLineCount(),
        sessionId: `session_${Date.now()}`,
        scope: this.sandbox.getScope()
      }),
      onFileBlock: (stmt) => this.handleFileBlock(stmt)
    });
    this.globalsApi = createGlobals({
      pauseController: this.streamController,
      renderSurface: {
        append: (id, element) => {
          this.emitEvent({ type: "display", componentId: id, jsx: serializeReactElement(element) });
        },
        renderForm: async (formId, element) => {
          this.activeFormId = formId;
          this.emitEvent({ type: "ask_start", formId, jsx: serializeReactElement(element) });
          return new Promise((resolve2) => {
            this.once(`form:${formId}`, (data) => {
              this.activeFormId = null;
              this.emitEvent({ type: "ask_end", formId });
              resolve2(data);
            });
          });
        },
        cancelForm: (formId) => {
          this.activeFormId = null;
          this.emit(`form:${formId}`, { _cancelled: true });
        }
      },
      asyncManager: this.asyncManager,
      serializationLimits: this.config.serializationLimits,
      askTimeout: this.config.askTimeout,
      onStop: (payload, source) => this.handleStop(payload, source),
      onDisplay: (id) => {
      },
      onAsyncStart: (taskId, label) => {
        this.emitEvent({ type: "async_start", taskId, label });
      },
      onTasklistDeclared: (tasklistId, plan) => {
        this.emitEvent({ type: "tasklist_declared", tasklistId, plan });
      },
      onTaskComplete: (tasklistId, id, output) => {
        this.emitEvent({ type: "task_complete", tasklistId, id, output });
      },
      onTaskFailed: (tasklistId, id, error) => {
        this.emitEvent({ type: "task_failed", tasklistId, id, error });
      },
      onTaskRetried: (tasklistId, id) => {
        this.emitEvent({ type: "task_retried", tasklistId, id });
      },
      onTaskSkipped: (tasklistId, id, reason) => {
        this.emitEvent({ type: "task_skipped", tasklistId, id, reason });
      },
      onTaskProgress: (tasklistId, id, message, percent) => {
        this.emitEvent({ type: "task_progress", tasklistId, id, message, percent });
      },
      onTaskAsyncStart: (tasklistId, id) => {
        this.emitEvent({ type: "task_async_start", tasklistId, id });
      },
      onTaskAsyncComplete: (tasklistId, id, output) => {
        this.emitEvent({ type: "task_async_complete", tasklistId, id, output });
      },
      onTaskAsyncFailed: (tasklistId, id, error) => {
        this.emitEvent({ type: "task_async_failed", tasklistId, id, error });
      },
      onTaskOrderViolation: (tasklistId, attemptedTaskId, readyTasks) => {
        this.emitEvent({ type: "task_order_violation", tasklistId, attemptedTaskId, readyTasks });
      },
      onTaskCompleteContinue: (tasklistId, completedTaskId, readyTasks) => {
        this.emitEvent({ type: "task_complete_continue", tasklistId, completedTaskId, readyTasks });
      },
      maxTaskRetries: this.config.maxTaskRetries,
      maxTasksPerTasklist: this.config.maxTasksPerTasklist,
      sleepMaxSeconds: this.config.sleepMaxSeconds,
      onLoadKnowledge: options.knowledgeLoader ? (selector) => {
        const content = options.knowledgeLoader(selector);
        const domains = Object.keys(content);
        this.emitEvent({ type: "knowledge_loaded", domains });
        return content;
      } : void 0,
      getClassInfo: options.getClassInfo ?? void 0,
      onLoadClass: options.loadClass ? (className) => {
        const info = options.getClassInfo?.(className);
        const methodNames = info?.methods.map((m) => m.name) ?? [];
        options.loadClass(className, this);
        this.emitEvent({ type: "class_loaded", className, methods: methodNames });
      } : void 0,
      onAskParent: options.onAskParent,
      isFireAndForget: options.isFireAndForget,
      onContextBudget: options.onContextBudget,
      onReflect: options.onReflect,
      onVectorSearch: async (query, topK) => {
        const matches = this.vectorIndex.search(query, topK);
        return matches.map((m) => ({ turn: m.turn, score: m.score, text: m.text, code: m.code }));
      },
      onCompress: options.onCompress,
      onFork: options.onFork,
      onTrace: options.onTrace,
      onPlan: options.onPlan,
      onCritique: options.onCritique,
      onLearn: options.onLearn,
      onCheckpoint: () => this.sandbox.snapshotScope(),
      onRollback: (snapshot) => this.sandbox.restoreScope(snapshot),
      onRespond: (promise, data) => {
        const entry = this.agentRegistry.findByPromise(promise);
        if (!entry) throw new Error("respond: unknown agent \u2014 pass the agent variable as the first argument");
        this.agentRegistry.respond(entry.varName, data);
      }
    });
    this.sandbox.inject("stop", this.globalsApi.stop);
    this.sandbox.inject("display", this.globalsApi.display);
    this.sandbox.inject("ask", this.globalsApi.ask);
    this.sandbox.inject("async", this.globalsApi.async);
    this.sandbox.inject("tasklist", this.globalsApi.tasklist);
    this.sandbox.inject("completeTask", this.globalsApi.completeTask);
    this.sandbox.inject("completeTaskAsync", this.globalsApi.completeTaskAsync);
    this.sandbox.inject("taskProgress", this.globalsApi.taskProgress);
    this.sandbox.inject("failTask", this.globalsApi.failTask);
    this.sandbox.inject("retryTask", this.globalsApi.retryTask);
    this.sandbox.inject("sleep", this.globalsApi.sleep);
    this.sandbox.inject("loadKnowledge", this.globalsApi.loadKnowledge);
    this.sandbox.inject("loadClass", this.globalsApi.loadClass);
    this.sandbox.inject("askParent", this.globalsApi.askParent);
    this.sandbox.inject("respond", this.globalsApi.respond);
    this.sandbox.inject("contextBudget", this.globalsApi.contextBudget);
    this.sandbox.inject("pin", this.globalsApi.pin);
    this.sandbox.inject("unpin", this.globalsApi.unpin);
    this.sandbox.inject("memo", this.globalsApi.memo);
    this.sandbox.inject("reflect", this.globalsApi.reflect);
    this.sandbox.inject("speculate", this.globalsApi.speculate);
    this.sandbox.inject("compress", this.globalsApi.compress);
    this.sandbox.inject("fork", this.globalsApi.fork);
    this.sandbox.inject("focus", this.globalsApi.focus);
    this.sandbox.inject("guard", this.globalsApi.guard);
    this.sandbox.inject("trace", this.globalsApi.trace);
    this.sandbox.inject("checkpoint", this.globalsApi.checkpoint);
    this.sandbox.inject("rollback", this.globalsApi.rollback);
    this.sandbox.inject("parallel", this.globalsApi.parallel);
    this.sandbox.inject("plan", this.globalsApi.plan);
    this.sandbox.inject("critique", this.globalsApi.critique);
    this.sandbox.inject("learn", this.globalsApi.learn);
    this.sandbox.inject("delegate", this.globalsApi.delegate);
    this.sandbox.inject("cachedFetch", this.globalsApi.cachedFetch);
    this.sandbox.inject("watch", this.globalsApi.watch);
    this.sandbox.inject("pipeline", this.globalsApi.pipeline);
    this.sandbox.inject("schema", this.globalsApi.schema);
    this.sandbox.inject("validate", this.globalsApi.validate);
    this.sandbox.inject("broadcast", this.globalsApi.broadcast);
    this.sandbox.inject("listen", this.globalsApi.listen);
    if (options.agentNamespaces) {
      for (const [name, ns] of Object.entries(options.agentNamespaces)) {
        this.sandbox.inject(name, ns);
      }
    }
    if (options.knowledgeNamespace) {
      this.sandbox.inject("knowledge", options.knowledgeNamespace);
    }
    this.recorder = new ConversationRecorder();
    this.on("event", (event) => this.recorder.recordEvent(event));
    this.onSpawn = options.onSpawn ? async (config) => {
      this.emitEvent({
        type: "agent_spawn_start",
        spaceName: config.spaceName,
        agentSlug: config.agentSlug,
        actionId: config.actionId
      });
      try {
        const result = await options.onSpawn(config);
        this.emitEvent({
          type: "agent_spawn_complete",
          spaceName: config.spaceName,
          agentSlug: config.agentSlug,
          actionId: config.actionId,
          result
        });
        return result;
      } catch (err) {
        this.emitEvent({
          type: "agent_spawn_failed",
          spaceName: config.spaceName,
          agentSlug: config.agentSlug,
          actionId: config.actionId,
          error: err?.message ?? String(err)
        });
        throw err;
      }
    } : void 0;
  }
  async executeStatement(source) {
    this.globalsApi.setCurrentSource(source);
    return this.sandbox.execute(source);
  }
  handleStop(payload, source) {
    this.stopCount++;
    this.agentRegistry.advanceTurn();
    this.globalsApi.checkWatchers((name) => this.sandbox.getValue(name));
    const cpState = this.globalsApi.getTasklistsState();
    const tasksBlock = generateTasksBlock(cpState);
    const resolvedInThisStop = /* @__PURE__ */ new Set();
    for (const [, sv] of Object.entries(payload)) {
      const entry = this.agentRegistry.findByPromise(sv.value);
      if (entry?.status === "resolved") resolvedInThisStop.add(entry.varName);
    }
    const agentsBlock = generateAgentsBlock(this.agentRegistry, resolvedInThisStop);
    const baseMsg = buildStopMessage(payload);
    let msg = baseMsg;
    if (tasksBlock) msg += `

${tasksBlock}`;
    if (agentsBlock) msg += `

${agentsBlock}`;
    this.messages.push({ role: "assistant", content: this.codeLines.join("\n") });
    this.messages.push({ role: "user", content: msg });
    this.emitEvent({
      type: "read",
      payload: Object.fromEntries(
        Object.entries(payload).map(([k, v]) => [k, v.value])
      ),
      blockId: `stop_${this.stopCount}`
    });
    this.emitEvent({ type: "scope", entries: this.sandbox.getScope() });
    const turnCode = this.codeLines.slice(this.turnCodeStart);
    this.recorder.recordStop(turnCode, payload, this.sandbox.getScope(), cpState);
    this.vectorIndex.index(source, turnCode.join("\n"), this.currentTurn);
    this.currentTurn++;
    this.turnCodeStart = this.codeLines.length;
  }
  handleError(error) {
    const msg = buildErrorMessage(error);
    this.messages.push({ role: "assistant", content: this.codeLines.join("\n") });
    this.messages.push({ role: "user", content: msg });
    this.emitEvent({ type: "scope", entries: this.sandbox.getScope() });
    const turnCode = this.codeLines.slice(this.turnCodeStart);
    this.recorder.recordError(turnCode, error, this.sandbox.getScope());
    this.turnCodeStart = this.codeLines.length;
  }
  async handleFileBlock(stmt) {
    const blockId = `file_${Date.now()}`;
    let result;
    const options = {
      workingDir: this.fileWorkingDir ?? process.cwd(),
      ledger: this.readLedger,
      gitClient: this.options.gitClient,
      autoCommit: this.options.autoCommit
    };
    if (stmt.type === "file_write") {
      result = await applyFileWrite(stmt.path, stmt.content, options);
      if (result.ok) {
        this.emitEvent({ type: "file_write", path: stmt.path, blockId });
      }
    } else {
      result = await applyFileDiff(stmt.path, stmt.diff, options);
      if (result.ok) {
        this.emitEvent({ type: "file_diff", path: stmt.path, blockId });
      }
    }
    if (!result.ok) {
      this.emitEvent({ type: "file_error", path: stmt.path, error: result.error, blockId });
      const msg = `\u2190 error [FileError] ${result.error}`;
      this.messages.push({ role: "assistant", content: this.codeLines.join("\n") });
      this.messages.push({ role: "user", content: msg });
    }
  }
  /**
   * Get the read ledger for this session.
   * Pass to setReadLedger() in the fs catalog module to track readFile() calls.
   */
  getReadLedger() {
    return this.readLedger;
  }
  /**
   * Handle a user message.
   */
  async handleUserMessage(text) {
    this.setStatus("executing");
    this.messages.push({ role: "user", content: text });
    this.recorder.recordUserMessage(text, this.sandbox.getScope());
  }
  /**
   * Feed tokens from the LLM stream.
   */
  async feedToken(token) {
    await this.streamController.feedToken(token);
  }
  /**
   * Finalize the LLM stream.
   * Returns 'complete' if done, or 'tasklist_incomplete' if tasks remain.
   */
  async finalize() {
    await this.streamController.finalize();
    const cpState = this.globalsApi.getTasklistsState();
    for (const [tasklistId, tasklist] of cpState.tasklists) {
      const hasRequiredIncomplete = tasklist.plan.tasks.some((t) => {
        const completion = tasklist.completed.get(t.id);
        const isIncomplete = !completion || completion.status !== "completed" && completion.status !== "skipped";
        return isIncomplete && !t.optional;
      });
      if (!hasRequiredIncomplete) continue;
      if (tasklist.runningTasks.size > 0) {
        await Promise.race([
          Promise.allSettled(
            [...tasklist.runningTasks].map(
              (id) => new Promise((resolve2) => {
                const check = () => {
                  if (!tasklist.runningTasks.has(id)) {
                    resolve2();
                    return;
                  }
                  setTimeout(check, 100);
                };
                check();
              })
            )
          ),
          new Promise((resolve2) => setTimeout(resolve2, this.config.taskAsyncTimeout))
        ]);
      }
      if (this.tasklistReminderCount < this.config.maxTasklistReminders) {
        this.tasklistReminderCount++;
        const ready = [...tasklist.readyTasks];
        const blocked = tasklist.plan.tasks.filter((t) => !tasklist.readyTasks.has(t.id) && !tasklist.completed.has(t.id) && !tasklist.runningTasks.has(t.id)).map((t) => `${t.id} (waiting on ${(t.dependsOn ?? []).join(", ")})`);
        const failed = [...tasklist.completed.entries()].filter(([_, c]) => c.status === "failed").map(([id]) => id);
        const msg = buildTasklistReminderMessage(tasklistId, ready, blocked, failed);
        const tasksBlock = generateTasksBlock(cpState);
        const fullMsg = tasksBlock ? `${msg}

${tasksBlock}` : msg;
        this.messages.push({ role: "assistant", content: this.codeLines.join("\n") });
        this.messages.push({ role: "user", content: fullMsg });
        const blockedIds = blocked.map((b) => b.split(" ")[0]);
        this.recorder.recordTasklistReminder(
          [...this.codeLines],
          tasklistId,
          ready,
          blockedIds,
          failed,
          this.sandbox.getScope(),
          cpState
        );
        this.codeLines = [];
        this.turnCodeStart = 0;
        this.emitEvent({ type: "tasklist_reminder", tasklistId, ready, blocked: blockedIds, failed });
        this.emitEvent({ type: "scope", entries: this.sandbox.getScope() });
        return "tasklist_incomplete";
      }
    }
    await this.asyncManager.drain(5e3);
    const turnCode = this.codeLines.slice(this.turnCodeStart);
    this.recorder.recordCompletion(turnCode, this.sandbox.getScope(), this.globalsApi.getTasklistsState(), "complete");
    this.turnCodeStart = this.codeLines.length;
    this.setStatus("complete");
    return "complete";
  }
  /**
   * Resolve a pending stop() call, allowing sandbox to continue.
   * Called by the runner after injecting the stop payload as a user message.
   */
  resolveStop() {
    this.globalsApi.resolveStop();
    this.streamController.resume();
  }
  /**
   * Inject a value into the sandbox as a global.
   * Used to inject class namespace objects after loadClass().
   */
  injectGlobal(name, value) {
    this.sandbox.inject(name, value);
  }
  /**
   * Resolve a pending ask() form.
   */
  resolveAsk(formId, data) {
    const hasListener = this.listenerCount(`form:${formId}`) > 0;
    console.log(`\x1B[90m  [session] resolveAsk ${formId} hasListener=${hasListener} activeFormId=${this.activeFormId}\x1B[0m`);
    this.emit(`form:${formId}`, data);
  }
  /**
   * Cancel a pending ask() form.
   */
  cancelAsk(formId) {
    this.emit(`form:${formId}`, { _cancelled: true });
  }
  /**
   * Cancel an async task.
   */
  cancelAsyncTask(taskId, message = "") {
    this.asyncManager.cancel(taskId, message);
    this.emitEvent({ type: "async_cancelled", taskId });
  }
  /**
   * Pause the session.
   */
  pause() {
    this.streamController.pause();
    this.setStatus("paused");
  }
  /**
   * Resume the session.
   */
  resume() {
    this.streamController.resume();
    this.setStatus("executing");
  }
  /**
   * Handle user intervention (message while agent is running).
   */
  handleIntervention(text) {
    if (this.activeFormId) {
      this.cancelAsk(this.activeFormId);
    }
    this.streamController.pause();
    const msg = buildInterventionMessage(text);
    this.messages.push({ role: "assistant", content: this.codeLines.join("\n") });
    this.messages.push({ role: "user", content: msg });
    this.recorder.recordIntervention([...this.codeLines], text, this.sandbox.getScope());
    this.codeLines = [];
    this.turnCodeStart = 0;
    this.emitEvent({ type: "scope", entries: this.sandbox.getScope() });
    this.streamController.resume();
  }
  /**
   * Get a snapshot of the current session state.
   */
  snapshot() {
    return {
      status: this.status,
      blocks: [...this.blocks],
      scope: this.sandbox.getScope(),
      asyncTasks: this.asyncManager.getAllTasks().map((t) => ({
        id: t.id,
        label: t.label,
        status: t.status,
        elapsed: Date.now() - t.startTime
      })),
      activeFormId: this.activeFormId,
      tasklistsState: this.globalsApi.getTasklistsState(),
      agentEntries: this.agentRegistry.getAll().map((e) => ({
        varName: e.varName,
        label: e.label,
        status: e.status,
        error: e.error
      }))
    };
  }
  /**
   * Get the full serializable conversation state.
   */
  getConversationState() {
    return this.recorder.getState();
  }
  /**
   * Get the current status.
   */
  getStatus() {
    return this.status;
  }
  /**
   * Get messages for context.
   */
  getMessages() {
    return this.messages;
  }
  /**
   * Get the public globals object (for passing to setup functions).
   */
  getGlobals() {
    return {
      stop: this.globalsApi.stop,
      display: this.globalsApi.display,
      ask: this.globalsApi.ask,
      async: this.globalsApi.async,
      tasklist: this.globalsApi.tasklist,
      completeTask: this.globalsApi.completeTask,
      completeTaskAsync: this.globalsApi.completeTaskAsync,
      taskProgress: this.globalsApi.taskProgress,
      failTask: this.globalsApi.failTask,
      retryTask: this.globalsApi.retryTask,
      sleep: this.globalsApi.sleep,
      loadKnowledge: this.globalsApi.loadKnowledge,
      loadClass: this.globalsApi.loadClass,
      askParent: this.globalsApi.askParent,
      respond: this.globalsApi.respond
    };
  }
  /**
   * Get the agent registry.
   */
  getAgentRegistry() {
    return this.agentRegistry;
  }
  /**
   * Get scope table as string.
   */
  getScopeTable() {
    return generateScopeTable(this.sandbox.getScope(), {
      maxVariables: this.config.workspace.maxScopeVariables,
      maxValueWidth: this.config.workspace.maxScopeValueWidth
    });
  }
  /**
   * Get raw scope entries (for internal use like speculate).
   */
  getScope() {
    return this.sandbox.getScope();
  }
  getPinnedMemory() {
    return this.globalsApi.getPinnedMemory();
  }
  getMemoMemory() {
    return this.globalsApi.getMemoMemory();
  }
  getFocusSections() {
    return this.globalsApi.getFocusSections();
  }
  setStatus(status) {
    this.status = status;
    this.emitEvent({ type: "status", status });
  }
  emitEvent(event) {
    this.emit("event", event);
  }
  /**
   * Destroy the session and clean up resources.
   */
  destroy() {
    this.agentRegistry.destroy();
    this.asyncManager.cancelAll();
    this.sandbox.destroy();
    this.hookRegistry.clear();
    this.removeAllListeners();
  }
};
var CLIENT_COMPONENTS = /* @__PURE__ */ new Set([
  "TextInput",
  "TextArea",
  "NumberInput",
  "Slider",
  "Checkbox",
  "Select",
  "MultiSelect",
  "DatePicker",
  "FileUpload"
]);
function serializeReactElement(element, depth = 0) {
  if (depth > 20) return { component: "div", props: {}, children: ["[max depth]"] };
  if (!element || typeof element !== "object" || !("type" in element)) {
    return { component: "span", props: {}, children: [String(element ?? "")] };
  }
  const el = element;
  const { children, ...restProps } = el.props ?? {};
  let component;
  if (typeof el.type === "string") {
    component = el.type;
  } else if (typeof el.type === "function") {
    const name = el.type.name || "";
    if (CLIENT_COMPONENTS.has(name)) {
      component = name;
    } else {
      const _consoleError = console.error;
      try {
        console.error = () => {
        };
        const rendered = el.type(el.props);
        return serializeReactElement(rendered, depth + 1);
      } catch {
        component = name || "div";
      } finally {
        console.error = _consoleError;
      }
    }
  } else {
    component = "div";
  }
  const safeProps = {};
  for (const [key, value] of Object.entries(restProps)) {
    if (typeof value === "function") continue;
    if (typeof value === "symbol") continue;
    safeProps[key] = value;
  }
  const serializedChildren = serializeChildren(children, depth);
  return { component, props: safeProps, children: serializedChildren.length > 0 ? serializedChildren : void 0 };
}
function serializeChildren(children, depth) {
  if (children == null) return [];
  if (typeof children === "string") return [children];
  if (typeof children === "number" || typeof children === "boolean") return [String(children)];
  if (Array.isArray(children)) {
    return children.flatMap((child) => serializeChildren(child, depth));
  }
  if (typeof children === "object" && "type" in children) {
    return [serializeReactElement(children, depth + 1)];
  }
  return [String(children)];
}

// src/parser/global-detector.ts
var GLOBALS = ["stop", "display", "ask", "async", "tasklist", "completeTask", "loadKnowledge"];
function detectGlobalCall(source) {
  const trimmed = source.trim();
  const withoutAwait = trimmed.startsWith("await ") ? trimmed.slice(6).trim() : trimmed;
  for (const name of GLOBALS) {
    if (withoutAwait.startsWith(name + "(") || withoutAwait.startsWith(name + " (")) {
      return name;
    }
  }
  const assignMatch = trimmed.match(/^(?:const|let|var)\s+\w+\s*=\s*(?:await\s+)?(\w+)\s*\(/);
  if (assignMatch) {
    const callee = assignMatch[1];
    if (GLOBALS.includes(callee)) {
      return callee;
    }
  }
  return null;
}

// src/context/code-window.ts
function computeTurnPriority(turn, turnIdx, totalTurns, allDeclarations, laterCode) {
  let priority = 0;
  priority += turnIdx / totalTurns * 10;
  if (turn.lines.some((l) => l.includes("// @keep"))) {
    priority += 100;
  }
  for (const decl of turn.declarations) {
    const regex = new RegExp(`\\b${decl}\\b`);
    if (regex.test(laterCode)) {
      priority += 5;
    }
  }
  for (const line of turn.lines) {
    const trimmed = line.trim();
    if (/^(var|let|const)\s+\w+\s*=\s*(async\s+)?function/.test(trimmed) || /^function\s+\w+/.test(trimmed) || /^class\s+\w+/.test(trimmed)) {
      priority += 3;
    }
  }
  return priority;
}
function compressCodeWindow(turns, maxLines) {
  if (turns.length === 0) return [];
  let totalLines = turns.reduce((sum, t) => sum + t.lines.length, 0);
  if (totalLines <= maxLines) {
    return turns.flatMap((t) => t.lines);
  }
  const allDeclarations = /* @__PURE__ */ new Set();
  for (const turn of turns) {
    for (const d of turn.declarations) allDeclarations.add(d);
  }
  const priorities = [];
  for (let i = 0; i < turns.length; i++) {
    const laterCode = turns.slice(i + 1).flatMap((t) => t.lines).join("\n");
    priorities.push({
      turnIdx: i,
      priority: computeTurnPriority(turns[i], i, turns.length, allDeclarations, laterCode),
      turn: turns[i]
    });
  }
  const sortedByPriority = [...priorities].sort((a, b) => a.priority - b.priority);
  const summarizedTurns = /* @__PURE__ */ new Set();
  let currentLines = totalLines;
  for (const entry of sortedByPriority) {
    if (currentLines <= maxLines) break;
    summarizedTurns.add(entry.turnIdx);
    currentLines -= entry.turn.lines.length;
    currentLines += 1;
  }
  const result = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (summarizedTurns.has(i)) {
      const startLine = turn.turnIndex;
      const endLine = startLine + turn.lines.length - 1;
      const declList = turn.declarations.length > 0 ? ` declared: ${turn.declarations.join(", ")}` : "";
      result.push(`// [lines ${startLine}-${endLine} executed]${declList}`);
    } else {
      result.push(...turn.lines);
    }
  }
  return result;
}
function buildSummaryComment(startLine, endLine, declarations) {
  const declList = declarations.length > 0 ? ` declared: ${declarations.join(", ")}` : "";
  return `// [lines ${startLine}-${endLine} executed]${declList}`;
}

// src/context/stop-decay.ts
var DEFAULT_TIERS2 = { full: 2, keysOnly: 5, summary: 10 };
function getDecayLevel(distance, tiers = DEFAULT_TIERS2) {
  if (distance <= tiers.full) return "full";
  if (distance <= tiers.keysOnly) return "keys";
  if (distance <= tiers.summary) return "count";
  return "removed";
}
function decayStopPayload(payload, distance, tiers = DEFAULT_TIERS2) {
  const level = getDecayLevel(distance, tiers);
  switch (level) {
    case "full":
      return formatFullPayload(payload);
    case "keys":
      return formatKeysPayload(payload);
    case "count":
      return formatCountPayload(payload);
    case "removed":
      return null;
  }
}
function formatFullPayload(payload) {
  const entries = Object.entries(payload).map(([key, sv]) => `${key}: ${sv.display}`);
  return `\u2190 stop { ${entries.join(", ")} }`;
}
function formatKeysPayload(payload) {
  const entries = Object.entries(payload).map(([key, sv]) => {
    const type = describeValueType(sv);
    return `${key}: ${type}`;
  });
  return `\u2190 stop { ${entries.join(", ")} }`;
}
function formatCountPayload(payload) {
  const count = Object.keys(payload).length;
  return `\u2190 stop (${count} value${count === 1 ? "" : "s"} read)`;
}
function describeValueType(sv) {
  const val = sv.value;
  if (val === null) return "null";
  if (val === void 0) return "undefined";
  if (Array.isArray(val)) return `Array(${val.length})`;
  if (typeof val === "object") {
    const keys = Object.keys(val);
    return `Object{${keys.join(",")}}`;
  }
  return typeof val;
}
function decayErrorMessage(errorMsg, distance, tiers = DEFAULT_TIERS2) {
  const level = getDecayLevel(distance, tiers);
  if (level === "removed") return null;
  if (level === "count") return "\u2190 error (1 error occurred)";
  return errorMsg;
}

// src/context/system-prompt.ts
function buildSystemPrompt(template, slots) {
  let result = template;
  for (const [key, value] of Object.entries(slots)) {
    const marker = `{{${key}}}`;
    result = result.replaceAll(marker, value);
  }
  return result;
}
function updateScopeInPrompt(systemPrompt, scopeTable) {
  const scopeStart = systemPrompt.indexOf("{{SCOPE}}");
  if (scopeStart === -1) {
    return systemPrompt;
  }
  return systemPrompt.replace(
    /\{\{SCOPE\}\}[\s\S]*?(?=\{\{|$)/,
    scopeTable + "\n\n"
  );
}

// src/security/function-registry.ts
function wrapFunction(name, fn, options = {}) {
  const timeout = options.timeout ?? 3e4;
  const rateState = options.rateLimit ? { calls: [] } : null;
  const wrapped = async function(...args) {
    if (rateState && options.rateLimit) {
      const now = Date.now();
      const { maxCalls, windowMs } = options.rateLimit;
      rateState.calls = rateState.calls.filter((t) => now - t < windowMs);
      if (rateState.calls.length >= maxCalls) {
        throw new Error(`Rate limit exceeded for ${name}: max ${maxCalls} calls per ${windowMs}ms`);
      }
      rateState.calls.push(now);
    }
    const start = Date.now();
    const result = await Promise.race([
      Promise.resolve(fn(...args)),
      new Promise(
        (_, reject) => setTimeout(() => reject(new Error(`Timeout: ${name} exceeded ${timeout}ms`)), timeout)
      )
    ]);
    const duration = Date.now() - start;
    options.onCall?.(name, args, duration);
    return result;
  };
  Object.defineProperty(wrapped, "name", { value: name });
  return wrapped;
}
var FunctionRegistry = class {
  functions = /* @__PURE__ */ new Map();
  options;
  constructor(options = {}) {
    this.options = options;
  }
  register(name, fn) {
    this.functions.set(name, wrapFunction(name, fn, this.options));
  }
  get(name) {
    return this.functions.get(name);
  }
  getAll() {
    const result = {};
    for (const [name, fn] of this.functions) {
      result[name] = fn;
    }
    return result;
  }
  has(name) {
    return this.functions.has(name);
  }
  names() {
    return [...this.functions.keys()];
  }
};

// src/security/jsx-sanitizer.ts
var BLOCKED_TAGS = /* @__PURE__ */ new Set(["script", "iframe", "object", "embed"]);
var DANGEROUS_PROPS = /* @__PURE__ */ new Set(["dangerouslySetInnerHTML"]);
var JAVASCRIPT_URL_PATTERN = /^\s*javascript:/i;
function sanitizeJSX(jsx, path = "root") {
  const errors = [];
  if (BLOCKED_TAGS.has(jsx.component.toLowerCase())) {
    errors.push({
      path,
      message: `Blocked element: <${jsx.component}> is not allowed`
    });
  }
  for (const [key, value] of Object.entries(jsx.props)) {
    if (DANGEROUS_PROPS.has(key)) {
      errors.push({
        path: `${path}.props.${key}`,
        message: `Dangerous prop: ${key} is not allowed`
      });
    }
    if ((key === "href" || key === "src" || key === "action") && typeof value === "string" && JAVASCRIPT_URL_PATTERN.test(value)) {
      errors.push({
        path: `${path}.props.${key}`,
        message: `javascript: URLs are not allowed in ${key}`
      });
    }
    if (key.startsWith("on") && key.length > 2 && key[2] === key[2].toUpperCase()) {
      if (typeof value === "string") {
        errors.push({
          path: `${path}.props.${key}`,
          message: `String event handler: ${key} must be a function, not a string`
        });
      }
    }
  }
  if (jsx.children) {
    for (let i = 0; i < jsx.children.length; i++) {
      const child = jsx.children[i];
      if (typeof child === "string") continue;
      const childErrors = sanitizeJSX(child, `${path}.children[${i}]`);
      errors.push(...childErrors);
    }
  }
  return errors;
}
function isJSXSafe(jsx) {
  return sanitizeJSX(jsx).length === 0;
}
function validateFormComponents(jsx, allowedComponents, path = "root") {
  const errors = [];
  if (path === "root" && jsx.component !== "Form" && jsx.component !== "form") {
    errors.push({
      path,
      message: "ask() root must be a <Form> component"
    });
  }
  if (jsx.children) {
    for (let i = 0; i < jsx.children.length; i++) {
      const child = jsx.children[i];
      if (typeof child === "string") continue;
      if (!allowedComponents.has(child.component) && child.component !== "Form" && child.component !== "form") {
        errors.push({
          path: `${path}.children[${i}]`,
          message: `Unknown form component: <${child.component}>. Only registered input components are allowed.`
        });
      }
      const childErrors = validateFormComponents(child, allowedComponents, `${path}.children[${i}]`);
      errors.push(...childErrors);
    }
  }
  return errors;
}

// src/catalog/mcp.ts
import { existsSync, readFileSync } from "fs";
function toPascalCase(key) {
  return key.replace(/[-_\s](.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (_, c) => c.toUpperCase());
}
function schemaToTypeSig(schema) {
  if (!schema || typeof schema !== "object") return "any";
  const s = schema;
  if (s.type === "object") {
    const props = s.properties;
    if (!props || Object.keys(props).length === 0) return "Record<string, unknown>";
    const required = new Set(Array.isArray(s.required) ? s.required : []);
    const parts = Object.entries(props).map(([key, val]) => {
      const opt = required.has(key) ? "" : "?";
      return `${key}${opt}: ${leafType(val)}`;
    });
    return `{ ${parts.join("; ")} }`;
  }
  return leafType(s);
}
function leafType(schema) {
  if (!schema || typeof schema !== "object") return "any";
  const s = schema;
  switch (s.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "any[]";
    case "null":
      return "null";
    case "object":
      return "Record<string, unknown>";
    default:
      return "any";
  }
}
async function loadMcpServersFromConfig(mcpServers, source = "config") {
  if (!mcpServers || typeof mcpServers !== "object" || Object.keys(mcpServers).length === 0) {
    return [];
  }
  let Client, StdioClientTransport, StreamableHTTPClientTransport, getDefaultEnvironment;
  try {
    ;
    ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
    ({ StdioClientTransport, getDefaultEnvironment } = await import("@modelcontextprotocol/sdk/client/stdio.js"));
    ({ StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js"));
  } catch {
    throw new Error(
      `MCP servers declared in ${source} but @modelcontextprotocol/sdk is not installed.
Run: pnpm add @modelcontextprotocol/sdk`
    );
  }
  const entries = [];
  for (const [key, serverConfig] of Object.entries(mcpServers)) {
    const name = toPascalCase(key);
    let transport;
    if (serverConfig.url) {
      transport = new StreamableHTTPClientTransport(
        new URL(serverConfig.url),
        serverConfig.headers ? { requestInit: { headers: serverConfig.headers } } : void 0
      );
    } else if (serverConfig.command) {
      transport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args ?? [],
        env: serverConfig.env ? { ...getDefaultEnvironment(), ...serverConfig.env } : void 0
      });
    } else {
      throw new Error(
        `MCP server "${key}" in ${source}: must specify either "command" (stdio) or "url" (HTTP)`
      );
    }
    const client = new Client({ name: "lmthing", version: "1.0.0" });
    await client.connect(transport);
    const { tools } = await client.listTools();
    const methods = tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      signature: `(args: ${schemaToTypeSig(tool.inputSchema)}) => Promise<any>`
    }));
    entries.push({
      name,
      key,
      methods,
      inject(injectGlobal) {
        const bindings = {};
        for (const tool of tools) {
          const toolName = tool.name;
          bindings[toolName] = async (args) => {
            const result = await client.callTool({
              name: toolName,
              arguments: args ?? {}
            });
            return result.content;
          };
        }
        injectGlobal(name, bindings);
      },
      close: () => client.close()
    });
  }
  return entries;
}
async function loadMcpServers(mcpJsonPath) {
  if (!existsSync(mcpJsonPath)) return [];
  let config;
  try {
    config = JSON.parse(readFileSync(mcpJsonPath, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse ${mcpJsonPath}: ${err}`);
  }
  return loadMcpServersFromConfig(config.mcpServers ?? {}, mcpJsonPath);
}

// src/catalog/web-search.ts
async function webSearch(query, maxResults = 10) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; THING-Agent/1.0)"
    }
  });
  if (!response.ok) {
    throw new Error(`Web search failed: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();
  const results = parseDuckDuckGoResults(html, maxResults);
  return {
    results,
    query,
    totalResults: results.length
  };
}
function parseDuckDuckGoResults(html, maxResults) {
  const results = [];
  const resultRegex = /<class="[^"]*result__a[^"]*"[^>]*>.*?<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>.*?<a[^>]*class="result__url"[^>]*>(.*?)<\/a>.*?<class="result__snippet">.*?<class="result__snippet"[^>]*>(.*?)<\/class>/gs;
  let match;
  let count = 0;
  while ((match = resultRegex.exec(html)) !== null && count < maxResults) {
    const [, url, titleHtml, urlText, snippet] = match;
    const title = titleHtml.replace(/<[^>]+>/g, "").trim();
    const cleanSnippet = snippet.replace(/<[^>]+>/g, "").trim();
    if (title && url) {
      results.push({
        title: decodeHtml(title),
        url: decodeHtml(url),
        snippet: decodeHtml(cleanSnippet)
      });
      count++;
    }
  }
  if (results.length === 0) {
    const simpleRegex = /<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>.*?<[^>]*class="[^"]*snippet[^"]*"[^>]*>([^<]+)</gs;
    let simpleMatch;
    let simpleCount = 0;
    while ((simpleMatch = simpleRegex.exec(html)) !== null && simpleCount < maxResults) {
      const [, url, title, snippet] = simpleMatch;
      if (title && url && !url.startsWith("/")) {
        results.push({
          title: decodeHtml(title.trim()),
          url: decodeHtml(url),
          snippet: decodeHtml(snippet.trim())
        });
        simpleCount++;
      }
    }
  }
  return results;
}
function decodeHtml(text) {
  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'"
  };
  return text.replace(/&[^;]+;/g, (entity) => entities[entity] || entity);
}
function formatWebSearchResults(response) {
  if (response.results.length === 0) {
    return `No results found for "${response.query}"`;
  }
  let output = `Search results for "${response.query}":

`;
  for (let i = 0; i < response.results.length; i++) {
    const result = response.results[i];
    output += `${i + 1}. ${result.title}
`;
    output += `   ${result.url}
`;
    output += `   ${result.snippet}

`;
  }
  return output;
}

// src/catalog/index.ts
var BUILTIN_MODULE_IDS = [
  "path",
  "date",
  "crypto",
  "json",
  "csv",
  "env",
  "fs",
  "fetch",
  "shell",
  "image",
  "db"
];
async function loadCatalog(moduleIds) {
  const ids = moduleIds === "all" ? [...BUILTIN_MODULE_IDS] : moduleIds;
  const modules = [];
  for (const id of ids) {
    if (!isBuiltinModule(id)) {
      throw new Error(`Unknown catalog module: ${id}`);
    }
    const mod = await importModule(id);
    modules.push(mod);
  }
  return modules;
}
function isBuiltinModule(id) {
  return BUILTIN_MODULE_IDS.includes(id);
}
async function importModule(id) {
  switch (id) {
    case "path":
      return (await import("./path-K3VLZVTH.js")).default;
    case "date":
      return (await import("./date-DL6PIRCI.js")).default;
    case "crypto":
      return (await import("./crypto-BTVPQPPV.js")).default;
    case "json":
      return (await import("./json-VPTMTXR6.js")).default;
    case "csv":
      return (await import("./csv-3IL3IKAY.js")).default;
    case "env":
      return (await import("./env-PPLEQ47H.js")).default;
    case "fs":
      return (await import("./fs-3D2DSOBT.js")).default;
    case "fetch":
      return (await import("./fetch-TN4ZJVQW.js")).default;
    case "shell":
      return (await import("./shell-NAGRIUA4.js")).default;
    case "image":
      return (await import("./image-FGNY3CMJ.js")).default;
    case "db":
      return (await import("./db-IVNVHDFE.js")).default;
  }
}
function mergeCatalogs(modules) {
  return modules.flatMap((m) => m.functions);
}
function getCatalogModule(modules, id) {
  return modules.find((m) => m.id === id);
}
function formatCatalogForPrompt(modules) {
  const lines = [];
  for (const mod of modules) {
    lines.push(`  # Built-in: ${mod.id}`);
    for (const fn of mod.functions) {
      lines.push(`  ${fn.name}${fn.signature}`);
      lines.push(`    \u2014 ${fn.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// src/knowledge/index.ts
import { readFileSync as readFileSync2, readdirSync, existsSync as existsSync2 } from "fs";
import { join } from "path";
function mergeKnowledgeTrees(trees) {
  const domainMap = /* @__PURE__ */ new Map();
  for (const tree of trees) {
    for (const domain of tree.domains) {
      const existing = domainMap.get(domain.slug);
      if (!existing) {
        domainMap.set(domain.slug, { ...domain, fields: [...domain.fields] });
      } else {
        const fieldSlugs = new Set(existing.fields.map((f) => f.slug));
        for (const field of domain.fields) {
          if (!fieldSlugs.has(field.slug)) {
            existing.fields.push(field);
          }
        }
      }
    }
  }
  return { domains: [...domainMap.values()] };
}
function buildKnowledgeTree(knowledgeDir) {
  if (!existsSync2(knowledgeDir)) {
    return { domains: [] };
  }
  const domains = [];
  const entries = readdirSync(knowledgeDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const domainPath = join(knowledgeDir, entry.name);
    const domain = readDomain(domainPath, entry.name);
    if (domain) domains.push(domain);
  }
  return { domains };
}
function readDomain(domainPath, slug) {
  const configPath = join(domainPath, "config.json");
  if (!existsSync2(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync2(configPath, "utf-8"));
    const fields = [];
    const entries = readdirSync(domainPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const field = readField(join(domainPath, entry.name), entry.name);
      if (field) fields.push(field);
    }
    return {
      slug,
      label: config.label ?? slug,
      description: config.description ?? "",
      icon: config.icon ?? "",
      color: config.color ?? "#888888",
      fields
    };
  } catch {
    return null;
  }
}
function readField(fieldPath, slug) {
  const configPath = join(fieldPath, "config.json");
  if (!existsSync2(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync2(configPath, "utf-8"));
    const options = [];
    const entries = readdirSync(fieldPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const optionSlug = entry.name.replace(/\.md$/, "");
      const option = readOptionMeta(join(fieldPath, entry.name), optionSlug);
      if (option) options.push(option);
    }
    options.sort((a, b) => a.order - b.order);
    return {
      slug,
      label: config.label ?? slug,
      description: config.description ?? "",
      fieldType: config.fieldType ?? "select",
      required: config.required ?? false,
      default: config.default,
      variableName: config.variableName ?? slug,
      options
    };
  } catch {
    return null;
  }
}
function readOptionMeta(filePath, slug) {
  try {
    const content = readFileSync2(filePath, "utf-8");
    const fm = parseFrontmatter(content);
    return {
      slug,
      title: fm.title ?? slug,
      description: fm.description ?? "",
      order: fm.order ?? 99
    };
  } catch {
    return null;
  }
}
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (!m) continue;
    const [, key, raw] = m;
    let value = raw.trim();
    if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    if (/^\d+$/.test(value)) value = parseInt(value, 10);
    result[key] = value;
  }
  return result;
}
function loadKnowledgeFiles(knowledgeDir, selector) {
  const result = {};
  for (const [domainSlug, fields] of Object.entries(selector)) {
    if (typeof fields !== "object" || fields === null) continue;
    result[domainSlug] = {};
    for (const [fieldSlug, options] of Object.entries(fields)) {
      if (typeof options !== "object" || options === null) continue;
      result[domainSlug][fieldSlug] = {};
      for (const [optionSlug, selected] of Object.entries(options)) {
        if (selected !== true) continue;
        const filePath = join(knowledgeDir, domainSlug, fieldSlug, `${optionSlug}.md`);
        if (!existsSync2(filePath)) continue;
        try {
          const content = readFileSync2(filePath, "utf-8");
          const body = content.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
          result[domainSlug][fieldSlug][optionSlug] = body;
        } catch {
        }
      }
    }
  }
  return result;
}
function formatKnowledgeTreeForPrompt(treeOrTrees) {
  const trees = Array.isArray(treeOrTrees) ? treeOrTrees : [treeOrTrees];
  const allDomains = trees.flatMap((t) => t.domains);
  if (allDomains.length === 0) return "(no knowledge loaded)";
  const lines = ["<knowledge>"];
  const hasNames = trees.some((t) => t.name);
  if (hasNames) {
    const nonEmpty = trees.filter((t) => t.domains.length > 0);
    for (const tree of nonEmpty) {
      lines.push(`  <space name="${xmlEsc(tree.name ?? "unknown")}">`);
      for (const domain of tree.domains) {
        formatDomainXml(lines, domain, "    ");
      }
      lines.push("  </space>");
    }
  } else {
    for (const domain of allDomains) {
      formatDomainXml(lines, domain, "  ");
    }
  }
  lines.push("</knowledge>");
  return lines.join("\n");
}
function formatDomainXml(lines, domain, indent) {
  lines.push(`${indent}<domain name="${xmlEsc(domain.slug)}" icon="${xmlEsc(domain.icon)}" label="${xmlEsc(domain.label)}">`);
  for (const field of domain.fields) {
    lines.push(`${indent}  <field name="${xmlEsc(field.slug)}" type="${xmlEsc(field.fieldType)}" var="${xmlEsc(field.variableName)}">`);
    for (const option of field.options) {
      const desc = option.description ? ` \u2014 ${xmlEsc(option.description)}` : "";
      lines.push(`${indent}    <option name="${xmlEsc(option.slug)}">${xmlEsc(option.title)}${desc}</option>`);
    }
    lines.push(`${indent}  </field>`);
  }
  lines.push(`${indent}</domain>`);
}
function xmlEsc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// src/knowledge/writer.ts
import { mkdirSync, writeFileSync, unlinkSync, existsSync as existsSync3, readdirSync as readdirSync2 } from "fs";
import { join as join2 } from "path";
var MEMORY_DOMAIN_CONFIG = {
  label: "Memory",
  description: "Persistent agent memory",
  icon: "\u{1F9E0}",
  color: "#9b59b6",
  renderAs: "section"
};
var MEMORY_FIELDS = {
  user: {
    label: "User",
    description: "User preferences and context",
    fieldType: "text",
    variableName: "userMemory"
  },
  project: {
    label: "Project",
    description: "Project-specific knowledge",
    fieldType: "text",
    variableName: "projectMemory"
  },
  feedback: {
    label: "Feedback",
    description: "Behavioral guidance",
    fieldType: "text",
    variableName: "feedbackMemory"
  },
  reference: {
    label: "Reference",
    description: "External resource pointers",
    fieldType: "text",
    variableName: "referenceMemory"
  }
};
function saveKnowledgeFile(knowledgeDir, domain, field, option, content) {
  const domainDir = join2(knowledgeDir, domain);
  const fieldDir = join2(domainDir, field);
  const filePath = join2(fieldDir, `${option}.md`);
  mkdirSync(fieldDir, { recursive: true });
  const domainConfigPath = join2(domainDir, "config.json");
  if (!existsSync3(domainConfigPath)) {
    if (domain === "memory") {
      writeFileSync(domainConfigPath, JSON.stringify(MEMORY_DOMAIN_CONFIG, null, 2), "utf-8");
    } else {
      writeFileSync(domainConfigPath, JSON.stringify({
        label: domain.charAt(0).toUpperCase() + domain.slice(1),
        description: "",
        icon: "\u{1F4C1}",
        color: "#888888",
        renderAs: "section"
      }, null, 2), "utf-8");
    }
  }
  const fieldConfigPath = join2(fieldDir, "config.json");
  if (!existsSync3(fieldConfigPath)) {
    const memoryFieldConfig = MEMORY_FIELDS[field];
    if (domain === "memory" && memoryFieldConfig) {
      writeFileSync(fieldConfigPath, JSON.stringify({
        ...memoryFieldConfig,
        required: false,
        renderAs: "field"
      }, null, 2), "utf-8");
    } else {
      writeFileSync(fieldConfigPath, JSON.stringify({
        label: field.charAt(0).toUpperCase() + field.slice(1),
        description: "",
        fieldType: "text",
        required: false,
        variableName: field,
        renderAs: "field"
      }, null, 2), "utf-8");
    }
  }
  const title = option.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  const hasFrontmatter = content.trimStart().startsWith("---");
  let fileContent;
  if (hasFrontmatter) {
    fileContent = content;
  } else {
    fileContent = `---
title: ${title}
description: ${content.slice(0, 80).replace(/\n/g, " ")}
order: 99
---

${content}
`;
  }
  writeFileSync(filePath, fileContent, "utf-8");
}
function deleteKnowledgeFile(knowledgeDir, domain, field, option) {
  const filePath = join2(knowledgeDir, domain, field, `${option}.md`);
  if (!existsSync3(filePath)) return false;
  unlinkSync(filePath);
  return true;
}
function ensureMemoryDomain(knowledgeDir) {
  if (!existsSync3(knowledgeDir)) {
    mkdirSync(knowledgeDir, { recursive: true });
  }
  const memoryDir = join2(knowledgeDir, "memory");
  mkdirSync(memoryDir, { recursive: true });
  const domainConfigPath = join2(memoryDir, "config.json");
  if (!existsSync3(domainConfigPath)) {
    writeFileSync(domainConfigPath, JSON.stringify(MEMORY_DOMAIN_CONFIG, null, 2), "utf-8");
  }
  for (const [fieldSlug, fieldConfig] of Object.entries(MEMORY_FIELDS)) {
    const fieldDir = join2(memoryDir, fieldSlug);
    mkdirSync(fieldDir, { recursive: true });
    const fieldConfigPath = join2(fieldDir, "config.json");
    if (!existsSync3(fieldConfigPath)) {
      writeFileSync(fieldConfigPath, JSON.stringify({
        ...fieldConfig,
        required: false,
        renderAs: "field"
      }, null, 2), "utf-8");
    }
  }
}
function parseFieldPath(fieldParam) {
  const parts = fieldParam.split("/");
  if (parts.length >= 2) {
    return { domain: parts[0], field: parts.slice(1).join("/") };
  }
  return { domain: "memory", field: parts[0] };
}

// src/git/client.ts
import { exec } from "child_process";
import { promisify } from "util";
var execAsync = promisify(exec);
var GitClient = class {
  workingDir;
  authorName;
  authorEmail;
  constructor(options = {}) {
    this.workingDir = options.workingDir ?? process.cwd();
    this.authorName = options.authorName ?? "THING Agent";
    this.authorEmail = options.authorEmail ?? "agent@lmthing.local";
  }
  /**
   * Check if git repo exists and has changes.
   */
  async getStatus() {
    try {
      const { stdout: branch } = await execAsync("git rev-parse --abbrev-ref HEAD", {
        cwd: this.workingDir
      });
      const { stdout: status } = await execAsync("git status --porcelain", {
        cwd: this.workingDir
      });
      return {
        exists: true,
        isRepo: true,
        hasChanges: status.trim().length > 0,
        branch: branch.trim()
      };
    } catch (err) {
      return { exists: false, isRepo: false, hasChanges: false };
    }
  }
  /**
   * Stage and commit a file change with a descriptive message.
   */
  async commitFile(filePath, message) {
    try {
      await execAsync(`git add "${filePath}"`, {
        cwd: this.workingDir
      });
      const author = `${this.authorName} <${this.authorEmail}>`;
      await execAsync(
        `git commit -m "${message}" --author="${author}" --no-verify`,
        { cwd: this.workingDir }
      );
      const { stdout: hash } = await execAsync("git rev-parse --short HEAD", {
        cwd: this.workingDir
      });
      return { ok: true, hash: hash.trim() };
    } catch (err) {
      return {
        ok: false,
        error: err.stderr || err.message || "Git commit failed"
      };
    }
  }
  /**
   * Stage and commit multiple files at once.
   */
  async commitFiles(filePaths, message) {
    try {
      const paths = filePaths.map((p) => `"${p}"`).join(" ");
      await execAsync(`git add ${paths}`, {
        cwd: this.workingDir
      });
      const author = `${this.authorName} <${this.authorEmail}>`;
      await execAsync(
        `git commit -m "${message}" --author="${author}" --no-verify`,
        { cwd: this.workingDir }
      );
      const { stdout: hash } = await execAsync("git rev-parse --short HEAD", {
        cwd: this.workingDir
      });
      return { ok: true, hash: hash.trim() };
    } catch (err) {
      return {
        ok: false,
        error: err.stderr || err.message || "Git commit failed"
      };
    }
  }
  /**
   * Get the current git status as a string.
   * Only shows changes to tracked files (not untracked files).
   */
  async getStatusString() {
    try {
      const { stdout } = await execAsync("git diff --name-status", {
        cwd: this.workingDir
      });
      return stdout.trim();
    } catch {
      return "";
    }
  }
  /**
   * Check if a specific file has uncommitted changes.
   */
  async isFileChanged(filePath) {
    try {
      const { stdout } = await execAsync(`git status --porcelain "${filePath}"`, {
        cwd: this.workingDir
      });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
};
function createGitClient(options) {
  return new GitClient(options);
}

// src/thing/entry.ts
function createThingSession(options = {}) {
  const sessionOptions = {
    ...options,
    gitClient: options.gitClient,
    autoCommit: options.autoCommit ?? true
  };
  return new Session(sessionOptions);
}
function quickStart(workingDir, gitAutoCommit = true) {
  const gitClient = gitAutoCommit ? createGitClient({ workingDir }) : void 0;
  return createThingSession({
    gitClient,
    autoCommit: gitAutoCommit,
    fileWorkingDir: workingDir
  });
}
var ThingAgent = class {
  session;
  constructor(options = {}) {
    this.session = new Session(options);
  }
  /**
   * Send a user message to the agent.
   */
  async sendMessage(text) {
    return this.session.handleUserMessage(text);
  }
  /**
   * Get the underlying session.
   */
  getSession() {
    return this.session;
  }
  /**
   * Get the agent's current scope.
   */
  getScope() {
    return this.session.getScopeTable();
  }
  /**
   * Get pinned memory.
   */
  getPinned() {
    return this.session.getPinnedMemory();
  }
  /**
   * Get agent memos.
   */
  getMemos() {
    return this.session.getMemoMemory();
  }
  /**
   * Check if agent is currently processing.
   */
  isBusy() {
    return this.session.getStatus() !== "idle";
  }
  /**
   * Get agent status.
   */
  getStatus() {
    return this.session.getStatus();
  }
  /**
   * Destroy the agent session.
   */
  destroy() {
    this.session.destroy();
  }
};

// src/spaces/creator.ts
function generatePackageJson(metadata) {
  return JSON.stringify(
    {
      name: metadata.name,
      version: metadata.version ?? "1.0.0",
      private: true
    },
    null,
    2
  );
}
function generateAgentConfig(agent) {
  return JSON.stringify(
    {
      title: agent.name,
      model: "gpt-4",
      knowledge: [],
      components: [],
      functions: []
    },
    null,
    2
  );
}
function generateSpaceStructure(metadata, agents = {}) {
  const files = {};
  files[`${metadata.name}/package.json`] = generatePackageJson(metadata);
  for (const [agentId, agent] of Object.entries(agents)) {
    const agentFolder = `${metadata.name}/agents/agent-${agentId}`;
    files[`${agentFolder}/config.json`] = generateAgentConfig(agent);
    files[`${agentFolder}/instruct.md`] = `---
title: ${agent.name}
model: gpt-4
actions: []
---

# ${agent.role}

${agent.instruct}
`;
  }
  return files;
}
function generateSpaceFileBlocks(metadata, agents = {}) {
  const files = generateSpaceStructure(metadata, agents);
  const blocks = [];
  for (const [path, content] of Object.entries(files)) {
    blocks.push(`\`\`\`\`${path}
${content}
\`\`\`\`
`);
  }
  return blocks;
}
function validateSpaceName(name) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}
function slugifySpaceName(input) {
  return input.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

// src/spaces/dynamic-loader.ts
function createDynamicSpaceLoader(options) {
  const { spacesDir, session, onSpawn, onReload, rebuildNamespaces } = options;
  let watcherHandle = null;
  let watching = false;
  async function rebuildAndInject() {
    const { agentTree, knowledgeNamespace } = await rebuildNamespaces(spacesDir);
    const sessionAny = session;
    for (const [name, ns] of Object.entries(agentTree)) {
      sessionAny.sandbox?.inject(name, ns);
    }
    if (knowledgeNamespace) {
      sessionAny.sandbox?.inject("knowledge", knowledgeNamespace);
    }
  }
  async function handleSpaceChange(spaceName) {
    onReload?.(spaceName);
    await rebuildAndInject();
  }
  return {
    async start() {
      if (watching) return;
      const { watchSpaces: watchSpaces2, isFileWatchingSupported: isFileWatchingSupported2 } = await import("./watcher-XIE7DUQ6.js");
      if (!isFileWatchingSupported2()) {
        console.warn("File watching not supported in this environment");
        return;
      }
      watcherHandle = await watchSpaces2({
        spacesDir,
        onChange: handleSpaceChange
      });
      watching = true;
    },
    async stop() {
      if (!watching) return;
      await watcherHandle?.stop();
      watcherHandle = null;
      watching = false;
    },
    async reload() {
      await rebuildAndInject();
    },
    isWatching: () => watching
  };
}
export {
  AgentRegistry,
  AsyncManager,
  ConversationRecorder,
  FocusController,
  FunctionRegistry,
  GitClient,
  HookRegistry,
  KNOWLEDGE_TAG,
  Sandbox,
  Session,
  StreamController,
  SystemPromptBuilder,
  ThingAgent,
  VectorIndex,
  buildErrorMessage,
  buildHookInterruptMessage,
  buildInterventionMessage,
  buildKnowledgeTree,
  buildStopMessage,
  buildSummaryComment,
  buildSystemPrompt,
  buildSystemPromptFromConfig,
  buildTaskContinueMessage,
  buildTaskOrderViolationMessage,
  buildTasklistReminderMessage,
  clear,
  compressCodeWindow,
  computeScopeDelta,
  createBracketState,
  createDefaultConfig,
  createDynamicSpaceLoader,
  createGitClient,
  createGlobals,
  createLineAccumulator,
  createThingSession,
  decayErrorMessage,
  decayKnowledgeValue,
  decayStopPayload,
  deleteKnowledgeFile,
  describeType2 as describeType,
  detectGlobalCall,
  ensureMemoryDomain,
  executeHooks,
  executeLine,
  extractDeclarations,
  extractVariableNames,
  feed,
  feedChunk,
  findMatches,
  flush,
  formatCatalogForPrompt,
  formatKnowledgeTreeForPrompt,
  formatWebSearchResults,
  generateAgentConfig,
  generateAgentsBlock,
  generateCurrentTaskBlock,
  generatePackageJson,
  generateScopeTable,
  generateSpaceFileBlocks,
  generateSpaceStructure,
  generateTasksBlock,
  getCatalogModule,
  getDecayLevel,
  getKnowledgeDecayLevel,
  isBalanced,
  isCompleteStatement,
  isFileWatchingSupported,
  isJSXSafe,
  isKnowledgeContent,
  loadCatalog,
  loadKnowledgeFiles,
  loadMcpServers,
  loadMcpServersFromConfig,
  matchPattern,
  mergeCatalogs,
  mergeConfig,
  mergeKnowledgeTrees,
  parseFieldPath,
  parseStatement,
  quickStart,
  recoverArgumentNames,
  renderTaskLine,
  resetBracketState,
  sanitizeJSX,
  saveKnowledgeFile,
  serialize,
  serializeTasklistsState,
  slugifySpaceName,
  tagAsKnowledge,
  transpile,
  truncateValue2 as truncateValue,
  updateScopeInPrompt,
  validateConfig,
  validateFormComponents,
  validateSpaceName,
  watchSpaces,
  webSearch,
  wrapFunction
};
