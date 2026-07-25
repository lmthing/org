/**
 * transformer.cjs — React Native's Metro babel transformer, plus one rewrite.
 *
 * RN's jest mocks (which `native-mocks.cjs` substitutes in) pull their shared helpers with
 * `jest.requireActual('../mockComponent')`. Metro's dependency collector only sees literal
 * `require()`/`import`, so those helpers would be left OUT of the bundle and the mock would explode
 * at runtime on an undefined module. Rewriting `jest.requireActual(x)` → `require(x)` before
 * collection is what makes RN's own mocks usable unmodified — the alternative is re-authoring
 * twenty mock files and owning their drift.
 *
 * The rewrite is scoped to files inside `@react-native/jest-preset` so no product code can be
 * affected by it.
 */
const path = require('node:path')
const upstream = require('@react-native/metro-babel-transformer')

const JEST_PRESET_DIR = path.join('@react-native', 'jest-preset')

/** `jest.requireActual(<args>)` → `require(<args>)`, dropping the Flow type argument. */
function jestRequireActualToRequire({ types: t }) {
  return {
    name: 'jest-require-actual-to-require',
    visitor: {
      CallExpression(nodePath) {
        const callee = nodePath.node.callee
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object, { name: 'jest' }) &&
          t.isIdentifier(callee.property, { name: 'requireActual' })
        ) {
          nodePath.node.callee = t.identifier('require')
          // Flow call type arguments (`jest.requireActual<T>(…)`) have no meaning on `require`.
          nodePath.node.typeArguments = null
          nodePath.node.typeParameters = null
        }
      },
    },
  }
}

module.exports = {
  ...upstream,
  transform(params) {
    if (params.filename.includes(JEST_PRESET_DIR)) {
      return upstream.transform({
        ...params,
        plugins: [...(params.plugins ?? []), jestRequireActualToRequire],
      })
    }
    return upstream.transform(params)
  },
  // Metro caches transform output keyed by the transformer's cache key. Without mixing this file
  // in, editing the rewrite above would serve stale, un-rewritten mocks from the cache.
  getCacheKey() {
    const upstreamKey = typeof upstream.getCacheKey === 'function' ? upstream.getCacheKey() : ''
    return `${upstreamKey}$lmthing-jest-requireactual-1`
  },
}
