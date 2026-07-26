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

/**
 * `export * as ns from '…'` (ES2020) is NOT handled by `@react-native/babel-preset@0.86` — its
 * plugin list has `export-default-from` but no `export-namespace-from`, and
 * `transform-modules-commonjs` then fails with "should be first transformed by
 * @babel/plugin-transform-export-namespace-from". `src/chat/index.ts` uses the syntax
 * (`export * as compat from './compat/index'`), so without this the whole chat barrel is
 * untransformable for native while being perfectly valid everywhere else.
 *
 * Enabled for ALL files rather than scoped, because it is standard syntax rather than a workaround.
 * `apps/mobile`'s own babel config must enable it too — the harness proving the graph transforms
 * says nothing about a device build whose preset lacks the plugin.
 */
const exportNamespaceFrom = require('@babel/plugin-transform-export-namespace-from').default

module.exports = {
  ...upstream,
  transform(params) {
    const plugins = [...(params.plugins ?? []), exportNamespaceFrom]
    if (params.filename.includes(JEST_PRESET_DIR)) {
      return upstream.transform({
        ...params,
        plugins: [...plugins, jestRequireActualToRequire],
      })
    }
    return upstream.transform({ ...params, plugins })
  },
  // Metro caches transform output keyed by the transformer's cache key. Without mixing this file
  // in, editing the rewrite above would serve stale, un-rewritten mocks from the cache.
  getCacheKey() {
    const upstreamKey = typeof upstream.getCacheKey === 'function' ? upstream.getCacheKey() : ''
    return `${upstreamKey}$lmthing-jest-requireactual-1-exportns-1`
  },
}
