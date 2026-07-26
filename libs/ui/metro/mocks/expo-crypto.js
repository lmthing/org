/**
 * expo-crypto — hand-written (no published jest mock; it is an Expo module).
 *
 * Delegates to the host's Web Crypto rather than inventing randomness, so the seam under test is
 * exercised against real cryptographic randomness and a suite can assert that two `state` values
 * differ without that being an artefact of the mock.
 *
 * `globalThis.crypto`, NOT `require('node:crypto')`: Metro resolves the bundle for a native
 * platform and has no Node builtins to offer, so a `node:` specifier fails the whole graph. The
 * bundle is executed by Node, which has had a global `crypto` since 18 — this is the one place the
 * harness may lean on that, and it is why the file says so out loud.
 */
function getRandomValues(typedArray) {
  return globalThis.crypto.getRandomValues(typedArray)
}

function randomUUID() {
  return globalThis.crypto.randomUUID()
}

module.exports = { getRandomValues, randomUUID }
