import { describe, it, expect, beforeAll } from 'vitest';

/**
 * **A write endpoint's request BODY is part of the contract** — `system-appbuilder` only.
 *
 * The bug this file exists for was total and silent. `plan_endpoints` described only a `fields` list
 * ("the keys of ONE item in the RESPONSE"), so nothing anywhere described what a caller SENDS.
 * `emit_types` built `Input` from the route's `[param]`s alone, which for a plain `POST` is none, so
 * every write endpoint's Input type degraded to `Record<string, unknown>`. The consequences ran all
 * the way to the screen:
 *
 *   `Record<string, unknown>` → `generateProjectContracts` emits an `inputSchema` with no
 *   `properties` → `SchemaForm` derives its fields from exactly that schema → the `create` page
 *   renders **"Nothing to fill in."** above a Save button.
 *
 * Measured on the first model-built app, on web AND on the Android emulator (0 `EditText` nodes). It
 * passed `buildApp`, `validateAppViews` and `renderSmokeViews` cleanly, because the spec and the data
 * were both perfectly consistent with a body that had never been specified. A `create` section
 * declares no fields BY DESIGN — that is the whole point of deriving them — so the endpoint is the
 * only place the information could have come from.
 *
 * These are viewbuilder nodes: `system-appbuilder` is FROZEN and its own copies are unchanged, which
 * is why this is a separate file rather than an addition to `build-live-project-types.test.ts` (that
 * suite loads the APPBUILDER's nodes).
 */

type EmitResult = { ok: boolean; dts: string; error: string };
type ValidateResult = { ok: boolean; errorCount: number; errors: Array<{ node: string; ref: string; message: string }> };

let emit: (ctx: unknown, inputs: Record<string, unknown>) => Promise<EmitResult>;
let validate: (ctx: unknown, inputs: Record<string, unknown>) => Promise<ValidateResult>;
let reconcile: (ctx: unknown, inputs: Record<string, unknown>) => Promise<EmitResult & { written: boolean }>;

const nodeUrl = (file: string): string =>
  new URL(`../../system-spaces/system-appbuilder/tasklists/build_live_project/${file}`, import.meta.url).href;

beforeAll(async () => {
  emit = ((await import(nodeUrl('09-emit_types.ts'))) as { run: typeof emit }).run;
  validate = ((await import(nodeUrl('08-validate_contract.ts'))) as { run: typeof validate }).run;
  reconcile = ((await import(nodeUrl('11-reconcile_tables.ts'))) as { run: typeof reconcile }).run;
});

/** A ctx that records writes — the only capability these nodes need. */
function writerCtx() {
  const written: Record<string, string> = {};
  return {
    written,
    ctx: {
      writeProjectFile: (path: string, contents: string) => {
        written[path] = contents;
        return { ok: true };
      },
      listProjectDir: () => ({ ok: true, entries: [] as string[] }),
      readProjectFile: () => ({ ok: false, content: '', error: 'none' }),
    },
  };
}

const plan = (endpoints: unknown[]) => ({ plan_endpoints: { endpoints } });

/** The Input interface's body, for asserting on properties rather than whole-file text. */
function inputBlock(dts: string, base: string): string {
  return new RegExp(`interface ${base}Input \\{([\\s\\S]*?)\\n\\}`).exec(dts)?.[1] ?? '';
}

describe('emit_types — Input carries the declared request body', () => {
  it('types a POST body from `input`, so a create form has fields to draw', async () => {
    const { ctx } = writerCtx();
    const r = await emit(
      ctx,
      plan([
        {
          name: 'create-plant',
          route: 'plants/POST',
          purpose: 'add a plant',
          fields: ['id: string'],
          input: ['name: string', 'room: string', 'waterIntervalDays: number', 'lastWatered?: string'],
        },
      ]),
    );

    const block = inputBlock(r.dts, 'CreatePlant');
    expect(block).toContain('name: string;');
    expect(block).toContain('room: string;');
    expect(block).toContain('waterIntervalDays: number;');
    // A `?` suffix makes the PROPERTY optional — what lets the form mark a field not-required
    // instead of demanding every one.
    expect(block).toContain('lastWatered?: string;');
    // And it must no longer fall back to the typeless shape.
    expect(r.dts).not.toContain('type CreatePlantInput = Record<string, unknown>;');
  });

  it('merges route [param]s with the body, and the path wins a name collision', async () => {
    const { ctx } = writerCtx();
    const r = await emit(
      ctx,
      plan([
        {
          name: 'water-plant',
          route: 'plants/[id]/water/POST',
          purpose: 'mark watered',
          fields: ['id: string'],
          // `id` already comes from the path; re-declaring it must not emit it twice.
          input: ['id: string', 'wateredOn: string'],
        },
      ]),
    );

    const block = inputBlock(r.dts, 'WaterPlant');
    expect(block).toContain('wateredOn: string;');
    expect(block.match(/\bid\s*:/g) ?? []).toHaveLength(1);
  });

  it('leaves a no-argument READ as Record<string, unknown> — the fallback is still correct there', async () => {
    const { ctx } = writerCtx();
    const r = await emit(ctx, plan([{ name: 'plants-list', route: 'plants-list/GET', fields: ['id: string'] }]));
    expect(r.dts).toContain('type PlantsListInput = Record<string, unknown>;');
  });
});

describe('reconcile_tables — the twin emitter must not UNDO the body', () => {
  /**
   * `11-reconcile_tables.ts` re-emits the WHOLE contract from what landed on disk, and it carries a
   * deliberate verbatim copy of `09-emit_types.ts`'s renderers (a code node is transpiled alone, so it
   * cannot import them). The first version of the body fix patched only `09`, and the twin then
   * overwrote its own upstream: on `13-plant-care` run 8 `plan_endpoints` declared `input` on
   * `create-plant` in all three planning rounds, `emit_types` resolved the correct 4-property
   * interface — and `types/contract.d.ts` on disk still ended up
   * `type CreatePlantInput = Record<string, unknown>;`, because this node ran after it.
   *
   * That is why this is asserted on the TWIN and not only on the source: an omission here is not a
   * missing feature, it is a silent regression of a feature that already worked.
   */
  it('re-emits `Input` WITH the declared body, so it cannot regress emit_types', async () => {
    const { ctx, written } = writerCtx();
    const r = await reconcile(ctx, {
      plan_endpoints: {
        endpoints: [
          {
            name: 'create-plant',
            route: 'plants/POST',
            purpose: 'add a plant',
            fields: ['id: string'],
            input: ['name: string', 'room: string', 'waterIntervalDays: number', 'lastWatered?: string'],
          },
        ],
      },
      plan_tables: { tables: [] },
      plan_view_components: { components: [] },
      implement_tables: {},
    });

    const dts = written['types/contract.d.ts'] ?? r.dts;
    expect(dts).not.toContain('type CreatePlantInput = Record<string, unknown>;');
    const block = inputBlock(dts, 'CreatePlant');
    expect(block).toContain('name: string;');
    expect(block).toContain('room: string;');
    expect(block).toContain('waterIntervalDays: number;');
    expect(block).toContain('lastWatered?: string;');
  });

  it('agrees with emit_types character-for-character on the endpoint section', async () => {
    // The two emitters are a copy of each other by design. The cheapest guard against them drifting
    // again is to assert they produce the SAME text for the same plan.
    const endpoints = [
      { name: 'create-plant', route: 'plants/POST', fields: ['id: string'], input: ['name: string', 'qty?: number'] },
      { name: 'water-plant', route: 'plants/[id]/water/POST', fields: ['id: string'], input: ['wateredOn: string'] },
      { name: 'plants-list', route: 'plants-list/GET', fields: ['id: string'] },
    ];
    const a = writerCtx();
    const b = writerCtx();
    const emitted = await emit(a.ctx, { plan_endpoints: { endpoints } });
    await reconcile(b.ctx, {
      plan_endpoints: { endpoints },
      plan_tables: { tables: [] },
      plan_view_components: { components: [] },
      implement_tables: {},
    });
    // Only the ENDPOINTS section: the two files differ elsewhere by design (this node keys
    // `TableRows` on the tables that actually LANDED, not on the plan).
    const section = (dts: string): string => {
      const start = dts.indexOf('interface CreatePlantItem');
      const end = dts.indexOf("  | 'plants-list';", start);
      return dts.slice(start, end);
    };
    const mine = section(b.written['types/contract.d.ts'] ?? '');
    expect(mine).not.toBe('');
    expect(mine).toBe(section(emitted.dts));
  });
});

describe("validate_contract — a FORM's endpoint must describe its body", () => {
  const findings = (r: ValidateResult) => r.errors.filter((e) => /declares no `input`/.test(e.message));

  /** A plan with one `create` page, which is what makes check (1b) applicable at all. */
  const withCreatePage = (endpoints: unknown[], endpoint = 'create-plant') => ({
    ...plan(endpoints),
    plan_views: [
      { route: 'plants/new', endpoints: [endpoint], sections: [{ id: 'f', kind: 'create', endpoint, bindings: [] }] },
    ],
  });

  it("rejects the endpoint a `create` section submits to when it declares no `input`", async () => {
    const { ctx } = writerCtx();
    const r = await validate(
      ctx,
      withCreatePage([{ name: 'create-plant', route: 'plants/POST', tables: [], fields: ['id: string'] }]),
    );
    const hit = findings(r);
    expect(hit).toHaveLength(1);
    // The message must name the SYMPTOM, not just the rule — this is a model-facing error.
    expect(hit[0]!.message).toContain('Nothing to fill in.');
    expect(hit[0]!.message).toContain("'key: type'");
    expect(r.ok).toBe(false);
  });

  it('accepts a form endpoint that declares one, and never flags a read', async () => {
    const { ctx } = writerCtx();
    const r = await validate(
      ctx,
      withCreatePage([
        { name: 'create-plant', route: 'plants/POST', tables: [], fields: ['id: string'], input: ['name: string'] },
        { name: 'plants-list', route: 'plants-list/GET', tables: [], fields: ['id: string'] },
        { name: 'drop-plant', route: 'plants/[id]/DELETE', tables: [], fields: ['id: string'] },
      ]),
    );
    expect(findings(r)).toEqual([]);
  });

  it('treats an EMPTY input list as absent — a present-but-useless field must not pass', async () => {
    const { ctx } = writerCtx();
    const r = await validate(
      ctx,
      withCreatePage([{ name: 'create-plant', route: 'plants/POST', tables: [], fields: ['id: string'], input: ['', '  '] }]),
    );
    expect(findings(r)).toHaveLength(1);
  });

  /**
   * The regression that cost `13-plant-care` run 8 both of its `onFail` attempts. The first version of
   * this check asked EVERY POST/PUT/PATCH for a body, so the two toggle/action endpoints — whose only
   * argument is the route `[param]` and whose new value the server computes — were flagged on every
   * pass. The model could not satisfy it (it tried `input: ['watered_at?: string']`, then `input: []`),
   * the retry budget ran out on a demand no correct plan can meet, and the DAG then ran on with the
   * plan's REAL findings unfixed.
   */
  it('never flags an ACTION write that no form reads — a body-less POST/PATCH is correct', async () => {
    const { ctx } = writerCtx();
    const r = await validate(ctx, {
      ...plan([
        { name: 'water-today', route: 'plants/[id]/water-today/POST', tables: ['plants'], fields: ['id: string'] },
        { name: 'toggle-resting', route: 'plants/[id]/toggle-resting/PATCH', tables: ['plants'], fields: ['id: string'] },
      ]),
      // Reached from a `toolbar`, which names no endpoint and derives no form.
      plan_views: [{ route: 'plants/[id]', endpoints: [], sections: [{ id: 'bar', kind: 'toolbar', bindings: [] }] }],
    });
    expect(findings(r)).toEqual([]);
  });
});
