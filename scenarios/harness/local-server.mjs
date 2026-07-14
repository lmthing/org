#!/usr/bin/env node
/**
 * Manage the one shared local `lmthing serve` the scenarios run against.
 *
 *   node scenarios/harness/local-server.mjs up        # start (or attach) — prints the base URL
 *   node scenarios/harness/local-server.mjs status     # pid + alive + base + log path
 *   node scenarios/harness/local-server.mjs restart     # after `pnpm build`: cycle to load new dist
 *   node scenarios/harness/local-server.mjs down        # stop it
 *
 * A product-code fix is thus `pnpm build && node scenarios/harness/local-server.mjs restart`
 * (seconds), replacing the prod push → CI image → rollout loop. Prompt/instruction fixes that
 * don't touch compiled code need no restart — write them through `/api/fs/write` and re-run.
 */
import { ensureLocalServer, restartLocalServer, stopLocalServer, localStatus } from './lib/local.mjs';

const cmd = process.argv[2] ?? 'status';
switch (cmd) {
  case 'up': {
    const base = await ensureLocalServer();
    console.log(base);
    break;
  }
  case 'restart': {
    const base = await restartLocalServer();
    console.log(base);
    break;
  }
  case 'down': {
    stopLocalServer();
    console.log('stopped');
    break;
  }
  case 'status':
    console.log(JSON.stringify(localStatus(), null, 2));
    break;
  default:
    console.error(`usage: local-server.mjs up|down|restart|status`);
    process.exit(1);
}
