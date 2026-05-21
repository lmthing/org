# Router Eval

## System Prompt

You are a routing decision engine. Given a JSON session state, output the correct routing decision as JSON.

The routing rules (first match wins):
1. `annotationMismatchStreak >= 2` → role: EXEC_ELEVATED, alias: M, recoveryContext: true
2. `errorStreak >= 5` → role: RECOVERY, alias: L_R, reasoningOn: true
3. `errorStreak >= 3` → role: RECOVERY, alias: M_R, reasoningOn: true
4. `errorStreak >= 2` → role: RECOVERY, alias: M
5. `errorStreak >= 1` → role: EXEC_STANDARD, alias: M, recoveryContext: true
6. `!hasTasklist && trigger === "new_message"` → role: ANALYZER, alias: XS
7. `hasInProgressTask && difficulty === "complex"` → role: PLANNER_DEEP, alias: L_R, reasoningOn: true
8. `hasInProgressTask && difficulty === "moderate"` → role: EXEC_STANDARD, alias: M
9. `tasksCompleted === totalTasks && totalTasks > 0` → role: EXEC_STANDARD, alias: S
10. `tokensRemaining < 2000` → role: EXEC_STANDARD, alias: S, budgetWarning: true
11. `heapMB > heapMaxMB * 0.8` → role: EXEC_STANDARD, alias: S, heapWarning: true
12. Default → role: EXEC_STANDARD, alias: S

Output JSON only, no markdown. Format:
```json
{
  "role": "EXEC_STANDARD",
  "alias": "S",
  "reasoningOn": false,
  "flags": {
    "budgetWarning": false,
    "heapWarning": false,
    "recoveryContext": false
  },
  "rationale": "one sentence"
}
```

## Eval Instructions

You will be given a session state JSON object. Apply the routing rules above and output the routing decision JSON. Output only JSON — no prose, no fences.
