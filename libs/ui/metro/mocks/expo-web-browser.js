/**
 * expo-web-browser — hand-written, like `expo-secure-store` and for the same reason: an Expo module
 * publishes no jest mock, because the real one calls into `expo-modules-core` and an OS browser.
 *
 * It stands in for the SFSafariViewController / Custom Tab, and nothing else. What it makes testable
 * is the seam's own logic: that the auth URL is built with the right `redirect_uri`, `app` and
 * `state`; that a mismatched `state` is rejected; that a dismissal is not an error; that a success
 * URL's `code` reaches the exchange. Those are the parts that can be wrong in our code.
 *
 * `__setResult` lets a suite choose what the "browser" returns. It is deliberately explicit rather
 * than clever: a mock that guessed would be asserting on itself.
 */
let nextResult = { type: 'cancel' }
let lastUrl = null

function __setResult(result) {
  nextResult = result
}

function __lastAuthUrl() {
  return lastUrl
}

async function openAuthSessionAsync(url, _redirectUrl) {
  lastUrl = url
  return nextResult
}

async function warmUpAsync() {}
async function coolDownAsync() {}
function maybeCompleteAuthSession() {
  return { type: 'failed', message: 'not supported on this platform' }
}

module.exports = {
  openAuthSessionAsync,
  warmUpAsync,
  coolDownAsync,
  maybeCompleteAuthSession,
  __setResult,
  __lastAuthUrl,
}
