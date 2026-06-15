# Issue: expand skill/plugin import scenarios (whole-plugin, marketplace-wide, commands/agents)

**Status:** open
**Severity:** enhancement
**Context:** `parseSkill` + `skillToSpec` (in `system-spaces/architect/functions/`) + the
`skill-to-space-transformer` agent's import workflow land single-`SKILL.md` import. EXP-D
(2026-06-14) confirmed end-to-end: imported the real `claude-md-improver` skill →
scaffolded/validated/registered → the imported agent produced a live CLAUDE.md audit.
This issue covers the scenarios NOT yet built or tested.

## What works today
- Single `SKILL.md` → one space, one `run` action, full instructions in a loadable
  `skill/playbook` knowledge option. (`parseSkill` also reads a dir containing a SKILL.md.)
- `parseSkill` detects a `plugin.json` / plugin dir and collects bundled SKILL.md files
  into `parsed.skills[]`, but `skillToSpec` currently flattens a plugin into ONE agent
  whose playbook has one knowledge option per bundled skill — it does NOT make a
  multi-agent space.
- Auto `defaultAction: run` on the single generated agent (reliable for weak models).

## Scenarios to build / test
1. **Whole-plugin import (multi-skill → multi-agent space).** A plugin bundling N skills
   should become ONE space with N agents (one per skill), each with its own `run` action +
   playbook, OR one agent with N actions. Decide the shape (see open questions).
2. **Marketplace-wide import.** `glob('**/SKILL.md')` under
   `~/.claude/plugins/marketplaces/*/plugins/*/skills/` then loop the import. Needs a
   batch entry point + dedupe of slug collisions across plugins.
3. **Plugin `commands/` (slash-command `.md`) and `agents/` (subagent `.md`).** These are
   NOT SKILL.md but carry importable instructions. `parseSkill` ignores them today.
4. **Skill resources/scripts.** `parseSkill` returns `resources[]` (sibling files) but
   `skillToSpec` drops them. Scripts could become space `functions/` or be referenced.
5. **Idempotent re-import / update** of an already-imported skill (re-scaffold + re-register).

## Open questions (resolve with the user before building)
- **Q1. Plugin → one space with many agents, or one agent with many actions?** Many agents
  is cleaner per-skill but heavier; many actions keeps it compact. Which?
- **Q2. Where do imported spaces live?** Currently `process.env.LMTHING_SPACE_DIR`'s parent
  (the fixtures dir). Should imports go to a dedicated `imported/` root? Be configurable?
- **Q3. Slug collisions** across a marketplace (two plugins with a skill of the same name) —
  namespace by plugin (`<plugin>__<skill>`), or last-wins, or error?
- **Q4. Scripts/resources** — do we copy them into the space and expose as `functions`
  (requires they be host-primitive-only TS, which arbitrary skill scripts are NOT), or just
  store paths in knowledge and let the agent `execShell` them? Probably the latter — confirm.
- **Q5. Commands vs skills vs agents** — should a plugin's slash-commands and subagents be
  imported as separate agents/actions, or ignored (skills only)?
- **Q6. Trust/safety** — imported instructions are third-party. Any sandboxing/review gate
  before an imported agent can `execShell`? (Read-only by default? An approval `ask()`?)
- **Q7. Does the imported agent need web/fs tools?** skillToSpec gives it none beyond the
  system toolkit. Some skills assume tools the LMThing runtime lacks — how to detect/degrade?

## Suggested plan (after Q1–Q7 answered)
1. Extend `skillToSpec` (or add `pluginToSpec`) to emit the chosen multi-agent/multi-action
   shape; keep it a PURE deterministic function (the weak-model robustness principle).
2. Add a batch helper (architect function `listImportableSkills(rootDir)` using glob) +
   an architect "import all under <root>" workflow that loops the existing import block.
3. Tests in `packages/core/src/spaces/architect-functions.test.ts`: a fake plugin dir with
   a `.claude-plugin/plugin.json` + 2 skills → assert the generated space shape, slug
   dedupe, and that each agent validates + scaffolds.
4. Live-verify via subagent against a real marketplace plugin (clean shell, launch from
   repo root). Confirm each imported agent runs.

## Key files
- `packages/core/system-spaces/architect/functions/parseSkill.ts`
- `packages/core/system-spaces/architect/functions/skillToSpec.ts`
- `packages/core/system-spaces/architect/agents/skill-to-space-transformer/instruct.md` (the import workflow)
- `packages/core/src/spaces/architect-functions.test.ts`
- Real samples: `~/.claude/plugins/marketplaces/*/plugins/*/{skills/*/SKILL.md,.claude-plugin/plugin.json,commands/*.md,agents/*.md}`
