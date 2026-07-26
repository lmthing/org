/**
 * native-mocks.cjs — the React Native native-module seam, expressed as a Metro resolver.
 *
 * A Metro bundle built for `platform: ios|android` contains the REAL React Native runtime, which
 * expects a native host: the first module that touches `TurboModuleRegistry` throws
 * `Invariant Violation: __fbBatchedBridgeConfig is not set, cannot invoke native modules`. Jest
 * solves this by mocking those modules (`@react-native/jest-preset/jest/setup.js`); there is no
 * module registry to patch inside a Metro bundle, so the equivalent has to happen one level down —
 * at RESOLUTION time. That is what this file is: the same mock list as RN's own jest preset,
 * applied as a `resolver.resolveRequest` redirect.
 *
 * React Native's own modules are redirected by their path INSIDE the react-native package, so both
 * `react-native/Libraries/Components/View/View` (from a lib) and `./View` (from inside RN itself)
 * land on the mock; third-party packages are redirected by specifier. The mock files are the ones
 * RN and those packages publish for jest — this file adds no fake behaviour of its own.
 *
 * The mocks are written for jest and call `jest.fn()` at module scope; `globals.cjs` installs the
 * minimal `jest` shim that satisfies them.
 */
const path = require('node:path')

/**
 * Mirrors the `mock(...)` calls in `@react-native/jest-preset/jest/setup.js`, one for one.
 * key = module path inside the `react-native` package · value = mock basename in
 * `@react-native/jest-preset/jest/mocks/`, or `null` for jest's "automock to an empty module".
 */
const RN_MODULE_MOCKS = {
  'Libraries/AppState/AppState': 'AppState',
  'Libraries/BatchedBridge/NativeModules': 'NativeModules',
  'Libraries/Components/AccessibilityInfo/AccessibilityInfo': 'AccessibilityInfo',
  'Libraries/Components/Clipboard/Clipboard': 'Clipboard',
  'Libraries/Core/InitializeCore': 'InitializeCore',
  'Libraries/Core/NativeExceptionsManager': null,
  'Libraries/Linking/Linking': 'Linking',
  'Libraries/NativeComponent/NativeComponentRegistry': 'NativeComponentRegistry',
  'Libraries/ReactNative/RendererProxy': 'RendererProxy',
  'Libraries/ReactNative/requireNativeComponent': 'requireNativeComponent',
  'Libraries/ReactNative/UIManager': 'UIManager',
  'Libraries/Utilities/useColorScheme': 'useColorScheme',
  'Libraries/Vibration/Vibration': 'Vibration',
}

/**
 * The mocks RN's jest preset applies that this harness deliberately does NOT.
 *
 * Jest replaces the COMPONENTS too (`View`, `Text`, `TextInput`, `Image`, `ScrollView`, `Modal`,
 * `ActivityIndicator`, `RefreshControl`) with `jest/mockComponent.js`, which loads the real module
 * through `jest.requireActual(moduleName)` — a require with a computed argument, which Metro cannot
 * resolve at build time and turns into a throw. Keeping those mocks would mean re-authoring them.
 *
 * Not mocking them is also the better test: the REAL React Native component code runs, and mounts
 * through the mocked `NativeComponentRegistry` as its real native view name. So a `View` appears in
 * the tree as `RCTView` and a `Text` as `RCTText` — one level closer to the device than jest shows.
 * `render.tsx#NATIVE_VIEW`/`NATIVE_TEXT` name those so suites don't hard-code the strings.
 */
const NOT_MOCKED_COMPONENTS = [
  'Libraries/Components/View/View',
  'Libraries/Components/View/ViewNativeComponent',
  'Libraries/Components/ActivityIndicator/ActivityIndicator',
  'Libraries/Components/RefreshControl/RefreshControl',
  'Libraries/Components/ScrollView/ScrollView',
  'Libraries/Components/TextInput/TextInput',
  'Libraries/Image/Image',
  'Libraries/Modal/Modal',
  'Libraries/Text/Text',
]

/** An empty module, standing in for jest's automock of a module with no explicit replacement. */
const EMPTY_MODULE = path.join(__dirname, 'mocks', 'empty.js')

/**
 * Third-party native packages, redirected to the mock THEY publish for exactly this purpose.
 *
 * `@lmthing/ui`'s `platform/` seams are thin wrappers over these two, so without the redirect the
 * seams cannot be tested at all: both reach for a TurboModule that only exists in a native binary.
 * Their own mocks are the same ones their READMEs tell jest users to install, so the behaviour under
 * test is the seam's, not ours.
 *
 * Keyed by SPECIFIER (the bare package name), which is how the seams import them — no path
 * comparison, so pnpm's several physical copies of a package are all covered by one entry.
 *
 * The `expo-*` entries are the exception to "their own mocks": Expo modules publish none, because
 * the real implementations talk to `expo-modules-core` and a native host. Ours are written locally
 * and each says exactly what it does and does not prove — see `mocks/expo-*.js`.
 */
const THIRD_PARTY_MOCKS = {
  '@react-native-async-storage/async-storage':
    '@react-native-async-storage/async-storage/jest',
  '@react-native-clipboard/clipboard': '@react-native-clipboard/clipboard/jest/clipboard-mock.js',
  'expo-secure-store': path.join(__dirname, 'mocks', 'expo-secure-store.js'),
  'expo-web-browser': path.join(__dirname, 'mocks', 'expo-web-browser.js'),
  'expo-linking': path.join(__dirname, 'mocks', 'expo-linking.js'),
  'expo-crypto': path.join(__dirname, 'mocks', 'expo-crypto.js'),
}

/** The marker a path inside any installed copy of react-native contains, exactly once. */
const RN_PACKAGE_SEGMENT = `${path.sep}node_modules${path.sep}react-native${path.sep}`

/**
 * Build the table, keyed by the module's path RELATIVE TO ITS OWN react-native package root
 * (`Libraries/BatchedBridge/NativeModules.js`).
 *
 * Absolute paths cannot be the key: pnpm installs react-native once per distinct peer set, so a
 * workspace can hold SEVERAL physically separate copies (here: one hashed for `@types/react`, one
 * for `@react-native/jest-preset`). They are different files, not symlinks, so neither string
 * comparison nor `realpath` matches across them — and a mock keyed to one copy silently missed
 * every import that arrived through the other. That is exactly how `@react-native-async-storage`
 * loaded the REAL `NativeModules` and died on `__fbBatchedBridgeConfig is not set`.
 *
 * A module that cannot be resolved is SKIPPED, not thrown on: RN moves files between versions, and
 * a harness that refuses to start because one mock target was renamed is worse than one that lets
 * the (loud, specific) invariant fire. `missing` is returned so callers can surface the drift.
 */
function buildMockTable() {
  const presetDir = path.dirname(require.resolve('@react-native/jest-preset/jest-preset'))
  const mocksDir = path.join(presetDir, 'jest', 'mocks')
  const table = new Map()
  const missing = []
  for (const [rnModule, mockName] of Object.entries(RN_MODULE_MOCKS)) {
    let resolved
    try {
      resolved = require.resolve(`react-native/${rnModule}`)
    } catch {
      missing.push(rnModule)
      continue
    }
    const key = rnRelativePath(resolved)
    if (key === null) {
      missing.push(rnModule)
      continue
    }
    table.set(key, mockName === null ? EMPTY_MODULE : path.join(mocksDir, `${mockName}.js`))
  }
  return { table, missing }
}

/** `…/node_modules/react-native/Libraries/x/y.js` → `Libraries/x/y.js`; `null` if not inside RN. */
function rnRelativePath(filePath) {
  const at = filePath.lastIndexOf(RN_PACKAGE_SEGMENT)
  return at === -1 ? null : filePath.slice(at + RN_PACKAGE_SEGMENT.length)
}

/**
 * A Metro `resolver.resolveRequest` that resolves normally and then swaps any RN module on the
 * mock list for its mock. `context.resolveRequest` is Metro's own default resolver when called
 * from inside a custom one (metro-resolver/src/resolve.js), so platform extension order,
 * package `exports` conditions and haste all still apply — only the final file is substituted.
 */
function createNativeMockResolver() {
  const { table, missing } = buildMockTable()
  const packageMocks = new Map()
  for (const [specifier, mockModule] of Object.entries(THIRD_PARTY_MOCKS)) {
    try {
      packageMocks.set(specifier, require.resolve(mockModule))
    } catch {
      missing.push(specifier)
    }
  }
  const resolveRequest = (context, moduleName, platform) => {
    const packageMock = packageMocks.get(moduleName)
    if (packageMock) return { type: 'sourceFile', filePath: packageMock }
    const result = context.resolveRequest(context, moduleName, platform)
    if (result.type === 'sourceFile') {
      const key = rnRelativePath(result.filePath)
      const mock = key === null ? undefined : table.get(key)
      if (mock) return { type: 'sourceFile', filePath: mock }
    }
    return result
  }
  return { resolveRequest, mockCount: table.size + packageMocks.size, missing }
}

module.exports = {
  createNativeMockResolver,
  RN_MODULE_MOCKS,
  NOT_MOCKED_COMPONENTS,
  THIRD_PARTY_MOCKS,
}
