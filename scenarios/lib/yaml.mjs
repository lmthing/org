/**
 * yaml.mjs — a minimal YAML-subset parser for `scenario.yaml`.
 *
 * The harness is zero-dependency and Node ships no YAML parser, so this covers exactly the shape the
 * scenario format uses (see ../campaign/scenario-spec.md) and nothing
 * more: nested maps, lists (scalar items AND map items), `>` (folded) / `|` (literal) block scalars,
 * inline flow arrays `[a, b]`, single/double-quoted and bare scalars, and `#`-comment / blank lines.
 * It is deliberately NOT a general YAML implementation — anchors, multi-doc, nested flow, etc. are
 * out of scope. Author scenarios in the documented style and this parses them faithfully.
 */

export function parseYaml(text) {
  const state = { lines: text.replace(/\r\n/g, '\n').split('\n'), i: 0 };
  return parseBlock(state, 0);
}

const indentOf = (s) => (s.match(/^ */) || [''])[0].length;
const skippable = (s) => {
  const t = s.trim();
  return t === '' || t.startsWith('#');
};

/** Index of the next significant (non-blank, non-comment) line at/after state.i, or -1. */
function nextSig(state) {
  let j = state.i;
  while (j < state.lines.length && skippable(state.lines[j])) j++;
  return j < state.lines.length ? j : -1;
}

/** Parse whatever block (map or list) begins at the next significant line >= minIndent. */
function parseBlock(state, minIndent) {
  const j = nextSig(state);
  if (j < 0) return null;
  const ind = indentOf(state.lines[j]);
  if (ind < minIndent) return null;
  const content = state.lines[j].slice(ind);
  return content === '-' || content.startsWith('- ') ? parseList(state, ind) : parseMap(state, ind);
}

function parseList(state, indent) {
  const arr = [];
  for (;;) {
    const j = nextSig(state);
    if (j < 0 || indentOf(state.lines[j]) !== indent) break;
    const content = state.lines[j].slice(indent);
    if (content !== '-' && !content.startsWith('- ')) break;
    const rest = content === '-' ? '' : content.slice(2);
    if (isMapEntry(rest)) {
      // Rewrite `- key: v` as a plain map line at indent+2 so parseMap folds it + its siblings
      // (which are already indented indent+2) into one object.
      state.lines[j] = ' '.repeat(indent + 2) + rest;
      state.i = j;
      arr.push(parseMap(state, indent + 2));
    } else {
      state.i = j + 1;
      arr.push(parseScalarOrBlock(state, rest, indent + 2));
    }
  }
  return arr;
}

function parseMap(state, indent) {
  const obj = {};
  for (;;) {
    const j = nextSig(state);
    if (j < 0 || indentOf(state.lines[j]) !== indent) break;
    const content = state.lines[j].slice(indent);
    if (content.startsWith('- ')) break; // a list here isn't a map entry
    const split = splitKey(content);
    if (!split) break;
    state.i = j + 1;
    if (split.value === '') {
      const child = parseBlock(state, indent + 1);
      obj[split.key] = child === null ? null : child;
    } else {
      obj[split.key] = parseScalarOrBlock(state, split.value, indent + 1);
    }
  }
  return obj;
}

function parseScalarOrBlock(state, valueStr, childIndent) {
  const v = valueStr.trim();
  if (v === '>' || v === '|') return parseBlockScalar(state, v === '|', childIndent);
  if (v.startsWith('[')) return parseFlowArray(v);
  return scalar(v);
}

/** A `>` (folded, blank line → newline) or `|` (literal, newlines kept) block scalar. */
function parseBlockScalar(state, literal, minIndent) {
  const out = [];
  let base = null;
  while (state.i < state.lines.length) {
    const line = state.lines[state.i];
    if (line.trim() === '') {
      out.push('');
      state.i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind < minIndent) break;
    if (base === null) base = ind;
    out.push(line.slice(base));
    state.i++;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  if (literal) return out.join('\n');
  let res = '';
  for (const l of out) {
    if (l === '') res += '\n';
    else res += (res && !res.endsWith('\n') ? ' ' : '') + l;
  }
  return res.trim();
}

function parseFlowArray(v) {
  const inner = v.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  return inner.split(',').map((s) => scalar(s.trim()));
}

/** True when a list item `rest` is a `key: ...` map entry (vs a bare scalar). */
function isMapEntry(rest) {
  return /^(?:"[^"]*"|'[^']*'|[A-Za-z_][\w-]*)\s*:(?:\s|$)/.test(rest);
}

/** Split a map line into { key, value } (value '' when the value is a nested block). */
function splitKey(content) {
  let key;
  let after;
  if (content[0] === '"' || content[0] === "'") {
    const q = content[0];
    const end = content.indexOf(q, 1);
    if (end < 0) return null;
    key = content.slice(1, end);
    after = content.slice(end + 1).trimStart();
    if (!after.startsWith(':')) return null;
    after = after.slice(1);
  } else {
    const c = content.indexOf(':');
    if (c < 0) return null;
    key = content.slice(0, c);
    after = content.slice(c + 1);
  }
  return { key: key.trim(), value: after.trim() };
}

function scalar(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~' || s === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
