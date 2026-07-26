/**
 * expo-secure-store — the one HAND-WRITTEN mock in this harness.
 *
 * Every other entry in `THIRD_PARTY_MOCKS` points at a mock the package itself publishes for jest,
 * which is what keeps the harness from testing our own fiction. `expo-secure-store` publishes none:
 * it is an Expo module, so the real implementation goes straight to `expo-modules-core` and the
 * device Keychain / Android Keystore, neither of which exists inside a Metro bundle running on Node.
 *
 * So this file stands in for the OS keystore, and nothing else. What it makes testable is the SEAM's
 * logic — that `hydrate` fills the cache, that a synchronous `readItem` can answer afterwards, that
 * a write updates memory before the store, that `removeItem` clears both. Those are the parts that
 * can be wrong in our code.
 *
 * What it deliberately does NOT prove: that the keystore is reached, that values are encrypted at
 * rest, or that a value survives a real app restart. Only a device shows that, and the plan says so
 * rather than letting a green harness imply it.
 *
 * The async shape is kept exactly — every method returns a Promise — because the seam exists
 * precisely to bridge async persistence to a synchronous read. A mock that resolved synchronously
 * would erase the problem under test.
 */
const store = new Map()

async function getItemAsync(key) {
  return store.has(key) ? store.get(key) : null
}

async function setItemAsync(key, value) {
  store.set(key, String(value))
}

async function deleteItemAsync(key) {
  store.delete(key)
}

async function isAvailableAsync() {
  return true
}

module.exports = {
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
  isAvailableAsync,
  // Named exports are how the seam imports it (`import * as SecureStore`); `default` keeps an
  // interop-style import working too.
  default: { getItemAsync, setItemAsync, deleteItemAsync, isAvailableAsync },
}
