// src/sandbox/read-ledger.ts
function createReadLedger() {
  return { paths: /* @__PURE__ */ new Set() };
}
function recordRead(ledger, path) {
  ledger.paths.add(path);
}
function hasBeenRead(ledger, path) {
  return ledger.paths.has(path);
}

export {
  createReadLedger,
  recordRead,
  hasBeenRead
};
