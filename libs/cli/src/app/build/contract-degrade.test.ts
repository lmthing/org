/**
 * **One unreadable handler must not take the whole app down.**
 *
 * `ts-json-schema-generator` throws (`UnknownNodeError`, "Unhandled error while creating Base
 * Type.") for a type it cannot resolve, and `generateEndpointContracts` ran every handler under a
 * single `Promise.all` — so ONE bad handler aborted `generateAppTypes`, and with it
 * `types/generated.d.ts`, the endpoint manifest, `/api/apps/:id/views` and the entire esbuild page
 * bundle, all reporting one message that named no file.
 *
 * Measured live, scenario `30-bike-workshop` run 202 step 4: an appbuilder follow-up edit dropped
 * six endpoints' declarations from `types/contract.d.ts`, the handlers that still referenced them
 * stopped resolving, and `POST /api/projects/bike-workshop/app/build` answered
 * `400 {"error":"Unhandled error while creating Base Type."}` with the root route 404ing. The
 * typecheck gate had the precise per-file diagnostics all along; the build just refused to run
 * beside them.
 *
 * So a per-endpoint schema failure now degrades THAT endpoint to a permissive contract, carries
 * the reason on `EndpointContract.schemaError`, and lets every other page and endpoint build.
 */
import { describe, expect, it, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateAppTypes } from './schema.js';
import { generateProjectContracts } from './contracts.js';

const tmpDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

/** A healthy endpoint — the one that must survive its neighbour's failure. */
const PING = `export const name = 'ping';

export interface Output { pong: boolean }

export default async function handler(): Promise<Output> {
  return { pong: true };
}
`;

/**
 * The shape a dropped contract declaration produces: `Output` names a global ambient type that
 * `types/contract.d.ts` no longer declares. This is exactly `api/bikes/GET.ts` after run 202's
 * step 3 re-emitted the contract from a plan that had forgotten it.
 */
const ORPHANED = `export const name = 'bikes-list';

export type Input = BikesListInput;
export type Output = BikesListOutput;

export default async function handler(input: Input): Promise<Output> {
  return { items: [] } as Output;
}
`;

/** A project whose SECOND endpoint references a type nothing declares. */
async function projectWithOneOrphanedHandler(): Promise<string> {
  const root = await scratch('lm-degrade-');
  await mkdir(join(root, 'api', 'ping'), { recursive: true });
  await mkdir(join(root, 'api', 'bikes'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'degrade-scratch', version: '0.0.0' }));
  await writeFile(join(root, 'api', 'ping', 'GET.ts'), PING, 'utf8');
  await writeFile(join(root, 'api', 'bikes', 'GET.ts'), ORPHANED, 'utf8');
  return root;
}

describe('a handler whose types do not resolve degrades that ENDPOINT, not the app', () => {
  it('generateAppTypes resolves instead of throwing, and marks only the offender', async () => {
    const root = await projectWithOneOrphanedHandler();
    const { endpoints } = await generateAppTypes(root);

    const bikes = endpoints.find((e) => e.name === 'bikes-list');
    const ping = endpoints.find((e) => e.name === 'ping');

    expect(bikes?.schemaError).toBeTruthy();
    // The endpoint keeps its identity: it still routes, it just cannot validate or derive a form.
    expect(bikes?.routePath).toBe('/bikes');
    // The healthy neighbour is untouched — its real Output shape survived.
    expect(ping?.schemaError).toBeUndefined();
    expect(JSON.stringify(ping?.outputSchema)).toContain('pong');
  }, 60_000);

  it('types/generated.d.ts is still written', async () => {
    const root = await projectWithOneOrphanedHandler();
    await generateAppTypes(root);
    const dts = await readFile(join(root, 'types', 'generated.d.ts'), 'utf8');
    expect(dts).toContain('PingOutput');
  }, 60_000);

  it('generateProjectContracts still produces validators and a manifest for the healthy endpoints', async () => {
    const root = await projectWithOneOrphanedHandler();
    const contracts = await generateProjectContracts(root);
    expect(contracts.validators.has('ping')).toBe(true);
    expect(contracts.endpoints.map((e) => e.name).sort()).toEqual(['bikes-list', 'ping']);
  }, 60_000);

});
