/**
 * expo-clipboard — hand-written (no published jest mock; it is an Expo module, same reasoning as
 * expo-secure-store.js in this directory).
 *
 * A real in-memory clipboard rather than a `jest.fn()` stub, so a suite can assert that a written
 * value round-trips through a read — the same round-trip the seam (`platform/clipboard.native.ts`)
 * exists to provide.
 */
let clipboard = ''

async function setStringAsync(text) {
  clipboard = text
  return true
}

async function getStringAsync() {
  return clipboard
}

module.exports = {
  setStringAsync,
  getStringAsync,
  default: { setStringAsync, getStringAsync },
}
