## Actual results — run 2026-07-12T02:34:24.445Z

**Verdict: ✅ PASS** · 10/10 checks · 0 issue(s) found · 0.5 min wall clock

### Step 0 — pre-flight

*Expected:* integration-demo ships its webhook emitter def; the pod holds the signing secret

| Check | Result | Actual |
|---|---|---|
| store catalog exposes integration-demo inbound demo/hmac | ✅ | [{"path":"demo","verify":"hmac"}] |
| store catalog exposes its message.received emitter contract | ✅ | message.received |
| webhook signing secret present in pod env | ✅ | already set |

### Step 2 — the storm (200 signed inbound deliveries)

*Expected:* 200×200 → exactly 200 new rows, counter +200, ZERO LLM calls, no 5xx, pod alive, event loop not starved

| Check | Result | Actual |
|---|---|---|
| all 200 deliveries returned 200 | ✅ | 200/200 · 5xx=0 |
| no 5xx | ✅ | 0 |
| a THING turn issued DURING the storm still completed | ✅ | 1 llm calls in 10289ms |
| the storm stored exactly 200 new rows | ✅ | +200 rows (now 201, was 1) |
| the counter advanced by exactly 200 (no lost increment under concurrency) | ✅ | +200 (now 201, was 1) |
| ZERO agent sessions spawned by the storm (no LLM in the hot path) | ✅ | none |
| a 10× replay of an identical delivery stores exactly ONE row | ✅ | +1 row(s); 9/10 answered {deduped:true} |

> before: 1 messages, counter=1, 0 live sessions

> replay statuses: 200,200,200,200,200,200,200,200,200,200 · bodies: [{"ok":true,"events":1},{"ok":true,"deduped":true},{"ok":true,"deduped":true},{"ok":true,"deduped":true},{"ok":true,"deduped":true},{"ok":true,"deduped":true},{"ok":true,"deduped":true},{"ok":true,"de

### Performance

| Metric | Value |
|---|---|
| delivery p50 | 831 ms |
| delivery p95 | 1837 ms |
| delivery max | 1876 ms |
| sequential leg (50) | 6.9 s → 7.2/s |
| storm wall clock | 14.6 s |
| storm throughput | 13.7 deliveries/s |
| concurrent THING turn | 10 s |
| rows/sec (end to end) | 13.7 |
