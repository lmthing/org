#!/usr/bin/env bash
#
# Keyless smoke suite for the live-testing plan (.claude/plans/live-testing.md §9).
#
# Drives the built CLI against fixture spaces with the scripted mock provider
# (--mock), so it needs NO API credentials and runs in ordinary CI. Each scenario
# runs, then asserts on the exit code and the --trace NDJSON with the §2 jq-style
# recipes (here implemented in node so jq is not required).
#
# Usage:  pnpm build && bash scripts/live-test.sh
# Exits non-zero if any assertion fails.

set -u
cd "$(dirname "$0")/.."

CLI="node packages/cli/dist/cli/bin.js"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()   { echo "  PASS: $1"; PASS=$((PASS + 1)); }
bad()  { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# count_events <tracefile> <node-filter-expr over `e`>  → prints the count
count() {
  node -e "const fs=require('fs');const ls=fs.readFileSync('$1','utf8').trim().split('\n').map(l=>JSON.parse(l));console.log(ls.filter(e=>$2).length)"
}
# solve_result <tracefile> <field> → prints the field of the resolved solve value
solve_field() {
  node -e "const fs=require('fs');const ls=fs.readFileSync('$1','utf8').trim().split('\n').map(l=>JSON.parse(l));const e=ls.find(e=>e.type==='yield_resolved'&&e.kind==='solve');console.log(e?e.value.$2:'MISSING')"
}

echo "== Phase 3A: solve passes on the first attempt (rung 0, attempts 1) =="
rm -rf fixtures/solver/work; T="$TMP/3a.jsonl"
$CLI --space fixtures/solver --claude --mock fixtures/solver/mock-pass.mjs --trace "$T" "implement add" >/dev/null 2>&1
[ "$(solve_field "$T" verified)" = "true" ] && ok "verified=true" || bad "verified should be true"
[ "$(solve_field "$T" rung)" = "0" ]        && ok "rung=0"       || bad "rung should be 0"
[ "$(solve_field "$T" attempts)" = "1" ]    && ok "attempts=1"   || bad "attempts should be 1"
[ "$(count "$T" "e.type==='llm_request'&&e.context&&e.context.startsWith('fork')")" = "1" ] \
  && ok "exactly one fork conversation" || bad "should be exactly one fork conversation"

echo "== Phase 3B: solve needs one retry (rung 1, attempts 2; feedback carried) =="
rm -rf fixtures/solver/work; T="$TMP/3b.jsonl"
$CLI --space fixtures/solver --claude --mock fixtures/solver/mock.mjs --trace "$T" "implement add" >/dev/null 2>&1
[ "$(solve_field "$T" verified)" = "true" ] && ok "verified=true" || bad "verified should be true"
[ "$(solve_field "$T" rung)" = "1" ]        && ok "rung=1"       || bad "rung should be 1"
[ "$(solve_field "$T" attempts)" = "2" ]    && ok "attempts=2"   || bad "attempts should be 2"
FB=$(count "$T" "e.type==='llm_request'&&e.context&&e.context.startsWith('fork')&&e.messages.map(m=>m.content).join(' ').includes('Feedback from the previous attempt')")
[ "$FB" = "1" ] && ok "retry fork carries verifier feedback" || bad "retry fork should carry feedback (got $FB)"

echo "== Phase 1A: episode cap fires (exit 1, 'episodes limit of 3') =="
T="$TMP/1a.jsonl"
ERR=$($CLI --space fixtures/engineer --claude --mock fixtures/engineer/mock.mjs --max-episodes 3 --trace "$T" "loop forever" 2>&1 >/dev/null); CODE=$?
[ "$CODE" -ne 0 ] && ok "non-zero exit ($CODE)" || bad "should exit non-zero"
echo "$ERR" | grep -q "episodes limit of 3" && ok "stderr names episodes limit" || bad "stderr should name episodes limit"
[ "$(count "$T" "e.type==='llm_request'&&e.context==='session'")" = "3" ] \
  && ok "exactly 3 session llm_requests" || bad "should be exactly 3 session llm_requests"

echo "== Phase 1B: tool-call cap fires (exit 1, 'toolCalls limit of 2') =="
T="$TMP/1b.jsonl"
ERR=$($CLI --space fixtures/engineer --claude --mock fixtures/engineer/mock.mjs --max-tool-calls 2 --trace "$T" "loop forever" 2>&1 >/dev/null); CODE=$?
[ "$CODE" -ne 0 ] && ok "non-zero exit ($CODE)" || bad "should exit non-zero"
echo "$ERR" | grep -q "toolCalls limit of 2" && ok "stderr names toolCalls limit" || bad "stderr should name toolCalls limit"

echo "== Phase 2A: progress() reads live counters =="
T="$TMP/2a.jsonl"
OUT=$($CLI --space fixtures/engineer --claude --mock fixtures/engineer/mock.mjs --trace "$T" "call progress and show the counts" 2>/dev/null)
echo "$OUT" | grep -qE "^episodes=[0-9]+ toolCalls=[0-9]+ elapsedMs=[0-9]+" \
  && ok "rendered numeric counters" || bad "should render numeric episodes/toolCalls/elapsedMs"

echo
echo "==== live-test summary: $PASS passed, $FAIL failed ===="
[ "$FAIL" -eq 0 ]
