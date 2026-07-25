/**
 * globals.cjs — the host environment a Metro native bundle expects, minus the device.
 *
 * Preloaded with `node --require` before the bundle runs (see `run.mjs`). It is the non-jest
 * transcription of `@react-native/jest-preset/jest/setup.js`: the same globals, and a `jest` shim
 * with exactly the two members RN's mocks call (`fn`, and `requireActual`, which the Metro
 * transformer has already rewritten to `require` — the shim keeps a definition for any straggler).
 *
 * Nothing here fakes React Native itself. RN's real JS runs in the bundle; this file only supplies
 * what a JS engine on a device would have provided.
 */

/** A `jest.fn()` that records calls, which is all RN's mocks (and our assertions) use. */
function mockFn(impl) {
  let implementation = impl
  const fn = (...args) => {
    fn.mock.calls.push(args)
    return implementation ? implementation(...args) : undefined
  }
  fn.mock = { calls: [] }
  fn.mockImplementation = (next) => ((implementation = next), fn)
  fn.mockReturnValue = (value) => ((implementation = () => value), fn)
  fn.mockResolvedValue = (value) => ((implementation = () => Promise.resolve(value)), fn)
  fn.mockClear = () => ((fn.mock.calls = []), fn)
  fn._isMockFunction = true
  return fn
}

globalThis.jest = {
  fn: mockFn,
  requireActual: (id) => require(id),
}

/**
 * Native modules that live in a device binary, for third-party packages that publish no mock of
 * their own. React Native looks here first (`Libraries/TurboModule/TurboModuleRegistry.js`) and
 * falls through to the mocked `NativeModules` when this returns null, so the list stays as short as
 * the suites require — anything absent still fails loudly with the module name in the message.
 *
 * These stub the DEVICE, never the code under test: a component reaching one of these is being
 * proven to MOUNT and wire up, not to do whatever the native side would have done.
 */
const NATIVE_MODULE_STUBS = {
  // react-native-webview: `NativeRNCWebViewModule` is resolved eagerly at import, so `IFrame`
  // cannot even be rendered without it.
  RNCWebViewModule: {
    getConstants: () => ({}),
    isFileUploadSupported: async () => false,
    shouldStartLoadWithLockIdentifier: () => {},
  },
}

globalThis.__turboModuleProxy = (name) => NATIVE_MODULE_STUBS[name] ?? null

Object.defineProperties(globalThis, {
  __DEV__: { configurable: true, writable: true, value: true },
  // react-test-renderer refuses to render without this, and RN's own flag silences the
  // "react-test-renderer is deprecated" warning it would otherwise print per render.
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
  IS_REACT_NATIVE_TEST_ENVIRONMENT: { configurable: true, writable: true, value: true },
  nativeFabricUIManager: { configurable: true, writable: true, value: {} },
  // RN's `Libraries/Utilities/*` reach for `window` as an alias of the global object. This is NOT
  // a DOM: there is no `document`, so anything that actually needs the DOM still fails loudly —
  // which is the point of running these tests on the native target.
  window: { configurable: true, writable: true, value: globalThis },
})

globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id)
