/**
 * Assemble the on-disk tree a bundled `lmthing` needs at runtime.
 *
 * ## Why there is a tree at all, and not just a bundle
 *
 * The CLI is not a program that happens to read some data files. Several of its
 * core paths resolve things *by walking the filesystem at runtime*, and each walk
 * is load-bearing:
 *
 *   - `defaultSystemSpaceDirs()` resolves the shipped system spaces RELATIVE TO
 *     THE CLI BUNDLE — `dist/cli/bin.js` → `../system-spaces`. tsup inlines
 *     `@lmthing/core`, so the core package's own copy is never consulted.
 *   - `findCliRoot()` walks up for the `package.json` named `@lmthing/cli`, then
 *     aliases `@app/runtime` to `<cliRoot>/src/app/runtime/index.ts` — TypeScript
 *     SOURCE, esbuilt per project. The dist has no standalone runtime module.
 *   - `findAppsBase()` walks up for a dir containing `apps/`, to find the SPA.
 *   - the project-app page build resolves `@lmthing/ui`, `@lmthing/css`,
 *     `@lmthing/auth` and `@lmthing/state` through real `node_modules` lookups.
 *
 * So the layout below deliberately MIRRORS the compute image's runtime stage
 * (`devops/argocd/compute/Dockerfile`), which is the one arrangement of these
 * files already proven to satisfy every walk in production. Inventing a flatter
 * one here would be re-deriving that proof, and each way of getting it wrong
 * fails late and quietly — a missing `src/app/runtime` does not break startup, it
 * breaks every project-app page build with `Could not resolve "@app/runtime"`.
 *
 * ## The external set is DERIVED, never hand-listed
 *
 * `tsup.config.ts` keeps a handful of packages external, and more are reached by
 * dynamic `import()`. A second hand-maintained copy of that list here would drift
 * — and drift silently, because a missing external only surfaces when the one
 * feature that needs it runs. {@link detectExternals} instead reads the built
 * bundles and takes every bare specifier they actually import as ground truth.
 */

import { execFileSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** scripts/bundle → libs/cli */
export const CLI_ROOT = join(__dirname, '..', '..');
/** scripts/bundle → sdk/org */
export const ORG_ROOT = join(CLI_ROOT, '..', '..');

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

/**
 * npm's own package-name grammar.
 *
 * A regex scan over built JS cannot tell an import from a string that merely
 * looks like one, and the bundle contains plenty of the latter — a template
 * literal `from "${spec}"` in the module resolver, the fragment `from"] === "`
 * inside a parser. Every one of those would reach `npm install` as a package
 * name and fail the build with a registry error naming something that was never
 * a dependency. The grammar is the cheap filter that removes all of them.
 */
const VALID_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * Specifiers that are name-shaped but are not packages, with why.
 *
 * These would otherwise pass {@link VALID_NAME} and be looked up on the registry.
 */
const NOT_A_PACKAGE = new Set([
  // An esbuild ALIAS, mapped by `resolveEnv` to the CLI's own runtime SOURCE at
  // `<cliRoot>/src/app/runtime/index.ts`. It has no registry entry and never will.
  '@app/runtime',
]);

/**
 * Packages reached in a way no static scan can see, with why.
 *
 * Keep this list SHORT and justified. Anything that can be detected should be
 * detected — an entry here is a claim that the scan structurally cannot find it.
 *
 * Note esbuild's actual compiler is a platform-specific sibling
 * (`@esbuild/linux-x64` …) resolved at runtime from a computed name. It does not
 * belong here: npm installs it as an optionalDependency of `esbuild`, correctly
 * for whichever platform the install runs on — which is the target's own runner.
 */
const UNSCANNABLE = [
  // Resolved by NAME FROM AN ARRAY OF STRINGS, never imported: both the
  // project-app page build and the `--web` dev server loop over
  // ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'] calling
  // `req.resolve(pkg)` to pin one React instance across the app and the
  // runtime-bundled space components. No scan of import syntax can see that, and
  // its absence does not break startup — it breaks every project-app page build
  // with an unresolved `react-dom/client`, long after the bundle shipped.
  'react-dom',
];

/** Everything under `dist/` that a scan should read. */
function jsFilesUnder(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) jsFilesUnder(p, out);
    else if (e.name.endsWith('.js') || e.name.endsWith('.cjs') || e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/**
 * First file under `dir` whose name is `name` or `name-<something>`, ignoring
 * archives.
 *
 * The prefix match is load-bearing, not defensive: upstream's archives do not
 * agree with each other. The gnu tarball contains a plain `zerostack`, while the
 * musl one contains `zerostack-x86_64-unknown-linux-musl`. An exact-name search
 * works until the day the triple changes, then fails with "no zerostack file
 * inside <url>" about an archive that plainly contains one.
 */
function findFileNamed(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const hit = findFileNamed(p, name);
      if (hit) return hit;
    } else if ((e.name === name || e.name.startsWith(`${name}-`)) && !/\.(tar\.gz|tgz|zip)$/.test(e.name)) {
      return p;
    }
  }
  return undefined;
}

/** `@scope/name/sub` → `@scope/name`; `name/sub` → `name`. */
function packageOf(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Every bare package specifier the built bundles import.
 *
 * Ground truth beats a hand-copied list: this sees `tsup.config.ts`'s `external`
 * entries and every dynamic `import('node-pty')`-style call alike, and it cannot
 * fall out of date with either.
 *
 * `@lmthing/*` is excluded — those are workspace packages, linked from the
 * monorepo by {@link linkWorkspacePackages} rather than fetched from a registry.
 *
 * EVERY shipped dist must be passed, not just the CLI's. `@lmthing/core` is
 * inlined into the CLI bundle, but its own `dist/` still ships — the `worker` and
 * `worker-load-entry` entrypoints import `@lmthing/core` at runtime as a real
 * package — and it has externals of its own. Scanning only the CLI produced a
 * bundle that installed, extracted and started, then died on the first import
 * with "Cannot find package 'yaml'".
 */
export function detectExternals(...distDirs) {
  const found = new Set();
  const dirs = distDirs.flat().filter((d) => existsSync(d));
  // The `from` clause is anchored to its `import`/`export` keyword, with no `;`
  // or `{` allowed in between so a match cannot span two statements. A bare
  // /\bfrom\s*"…"/ also matches ENGLISH: `/** Transition a scope from 'queued' to
  // 'running'. */` in core's dist made the build demand a package named "queued".
  // Comment prose is the dominant false positive in bundled hand-written code,
  // and every one of them fails the build rather than shipping — but a build
  // that fails on a docstring is still a build nobody can run.
  const patterns = [
    /\b(?:import|export)\b[^;]{0,400}?\bfrom\s*["']([^"'\n]+)["']/g,
    /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
  ];
  for (const file of dirs.flatMap((d) => jsFilesUnder(d))) {
    const src = readFileSync(file, 'utf8');
    for (const re of patterns) {
      for (const m of src.matchAll(re)) {
        const spec = m[1];
        if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('#')) continue;
        if (BUILTINS.has(spec)) continue;
        const pkg = packageOf(spec);
        if (pkg.startsWith('@lmthing/')) continue;
        if (BUILTINS.has(pkg)) continue;
        if (!VALID_NAME.test(pkg)) continue;
        if (NOT_A_PACKAGE.has(pkg) || NOT_A_PACKAGE.has(spec)) continue;
        found.add(pkg);
      }
    }
  }
  for (const pkg of UNSCANNABLE) found.add(pkg);
  return [...found].sort();
}

/**
 * Find a package's directory by walking `node_modules` upward.
 *
 * NOT `require.resolve('<pkg>/package.json')`: a modern package with an
 * `exports` map does not expose its own manifest, so that throws for `ink`,
 * `ink-text-input`, `unpdf` and `@tailwindcss/node` — all of which are perfectly
 * present. Resolving through the exports map would report them missing and
 * either fail the build or, worse, quietly drop them from the payload.
 */
function findPackageDir(name, roots = SEARCH_ROOTS) {
  for (const root of roots) {
    let dir = root;
    for (;;) {
      const candidate = join(dir, 'node_modules', name);
      if (existsSync(join(candidate, 'package.json'))) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

/**
 * Where to look for a package, in order.
 *
 * The core package's own `node_modules` is not optional here. pnpm does not
 * hoist, so `quickjs-emscripten` — the WASM sandbox the entire runtime is built
 * on — is reachable from `libs/core` and from nowhere else. Searching only from
 * the CLI reported it, and `queued`, as missing packages.
 */
const SEARCH_ROOTS = [CLI_ROOT, join(ORG_ROOT, 'libs', 'core'), ORG_ROOT];

/**
 * Pin each detected package to the version the monorepo actually resolves.
 *
 * Resolving from the real workspace rather than reading a manifest range means
 * the bundle ships what the repo was tested with, not "whatever satisfies ^x.y".
 * A package that cannot be resolved is REPORTED, not skipped: skipping produces a
 * bundle that is missing exactly one feature, discovered in the field.
 */
export function pinVersions(packages) {
  const deps = {};
  const unresolved = [];
  for (const pkg of packages) {
    const dir = findPackageDir(pkg);
    if (!dir) {
      unresolved.push(pkg);
      continue;
    }
    try {
      deps[pkg] = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
    } catch {
      unresolved.push(pkg);
    }
  }
  return { deps, unresolved };
}

/** Copy `src` → `dest`, creating parents. Throws when the source is absent. */
function copyRequired(src, dest, what) {
  if (!existsSync(src)) {
    throw new Error(
      `[payload] missing ${what}: ${src}\n` +
        `  the workspace is not fully built — run, from sdk/org:\n` +
        `    pnpm --filter @lmthing/core build && pnpm --filter @lmthing/cli build && (cd apps/web && pnpm exec vp build)`,
    );
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, dereference: false });
}

/**
 * The `@lmthing/*` workspace packages, linked into the payload's `node_modules`
 * as RELATIVE symlinks so the tree stays relocatable — it is extracted to a
 * content-addressed cache dir whose path is not known at build time.
 */
function linkWorkspacePackages(payload, names) {
  const nm = join(payload, 'node_modules', '@lmthing');
  mkdirSync(nm, { recursive: true });
  for (const name of names) {
    const target = relative(nm, join(payload, 'libs', name));
    const link = join(nm, name);
    rmSync(link, { force: true, recursive: true });
    symlinkSync(target, link, 'dir');
  }
}

/**
 * Fetch and unpack the vendored zerostack binary for `target` into `payload/bin`.
 *
 * Verified with `--version` at BUILD time rather than trusted: a broken or
 * truncated download otherwise ships, and surfaces only when a person escalates
 * work to zerostack inside a running pod — about as far from the cause as it gets.
 */
export function vendorZerostack(payload, target, log = console.log) {
  // A target upstream publishes nothing for (Windows). Skipping is the DECLARED
  // outcome, not a swallowed failure: `target.zerostack` says so, the manifest
  // records it, and the launcher then leaves `LMTHING_ZEROSTACK_BIN` unset so the
  // endpoint reports the binary as not installed — which is true.
  if (!target.zerostackUrl) {
    log(`[payload] zerostack SKIPPED — upstream publishes no ${target.id} build`);
    return null;
  }

  const binDir = join(payload, 'bin');
  mkdirSync(binDir, { recursive: true });
  const tmp = join(payload, '.zerostack-download');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  log(`[payload] zerostack ← ${target.zerostackUrl}`);
  const tar = join(tmp, 'zs.tar.gz');
  execFileSync('curl', ['-fsSL', '-o', tar, target.zerostackUrl], { stdio: 'inherit' });
  execFileSync('tar', ['-xzf', tar, '-C', tmp], { stdio: 'inherit' });

  // Walked in JS rather than shelled out to `find`, which does not exist on
  // Windows — and where it does exist, its output would still need parsing.
  const found = findFileNamed(tmp, 'zerostack');
  if (!found) throw new Error(`[payload] no "zerostack" file inside ${target.zerostackUrl}`);

  const dest = join(binDir, 'zerostack');
  cpSync(found, dest);
  chmodSync(dest, 0o755);
  rmSync(tmp, { recursive: true, force: true });

  // Only meaningful when building for the host's own platform; a cross-target
  // binary cannot be executed here, and refusing to build one would be wrong.
  if (`${process.platform}-${process.arch}` === target.id) {
    const v = execFileSync(dest, ['--version'], { encoding: 'utf8' }).trim();
    log(`[payload] zerostack ok: ${v}`);
  } else {
    log(`[payload] zerostack staged (cross-target ${target.id}; --version not run here)`);
  }
  return dest;
}

/**
 * Build the complete payload tree at `payload` for `target`.
 *
 * Returns the manifest describing what went in, which the launcher reads back to
 * locate the entrypoint and the vendored binaries.
 */
export function buildPayload({ payload, target, log = console.log }) {
  rmSync(payload, { recursive: true, force: true });
  mkdirSync(payload, { recursive: true });

  const cliDist = join(CLI_ROOT, 'dist');
  const coreRoot = join(ORG_ROOT, 'libs', 'core');

  // ── the runtime bundles ────────────────────────────────────────────────────
  copyRequired(cliDist, join(payload, 'libs/cli/dist'), '@lmthing/cli dist (pnpm --filter @lmthing/cli build)');
  copyRequired(join(CLI_ROOT, 'package.json'), join(payload, 'libs/cli/package.json'), 'cli package.json');
  // `findCliRoot()` aliases `@app/runtime` at this exact path, as TS SOURCE.
  copyRequired(join(CLI_ROOT, 'src/app/runtime'), join(payload, 'libs/cli/src/app/runtime'), 'cli app runtime source');

  copyRequired(join(coreRoot, 'dist'), join(payload, 'libs/core/dist'), '@lmthing/core dist');
  copyRequired(join(coreRoot, 'package.json'), join(payload, 'libs/core/package.json'), 'core package.json');
  copyRequired(join(coreRoot, 'system-spaces'), join(payload, 'libs/core/system-spaces'), 'system spaces');

  // The cli bundle inlines core, so `defaultSystemSpaceDirs()` looks for the
  // spaces beside the BUNDLE. Both copies are load-bearing; neither is redundant.
  copyRequired(join(coreRoot, 'system-spaces'), join(payload, 'libs/cli/dist/system-spaces'), 'system spaces (bundle-relative)');

  // ── source-only workspace libs the page build resolves ─────────────────────
  copyRequired(join(ORG_ROOT, 'libs/ui/src'), join(payload, 'libs/ui/src'), '@lmthing/ui src');
  copyRequired(join(ORG_ROOT, 'libs/ui/package.json'), join(payload, 'libs/ui/package.json'), 'ui package.json');
  for (const lib of ['auth', 'css', 'state', 'utils']) {
    copyRequired(join(ORG_ROOT, 'libs', lib), join(payload, 'libs', lib), `@lmthing/${lib}`);
    rmSync(join(payload, 'libs', lib, 'node_modules'), { recursive: true, force: true });
  }

  // ── the served SPA ─────────────────────────────────────────────────────────
  copyRequired(join(ORG_ROOT, 'apps/web/dist'), join(payload, 'apps/web/dist'), 'unified web app dist (cd apps/web && pnpm exec vp build)');

  // ── third-party runtime deps ───────────────────────────────────────────────
  const packages = detectExternals(cliDist, join(coreRoot, 'dist'));
  const { deps, unresolved } = pinVersions(packages);
  if (unresolved.length) {
    throw new Error(
      `[payload] the built bundle imports packages that do not resolve in this workspace: ${unresolved.join(', ')}\n` +
        `  install them (pnpm install) before bundling — shipping without them removes exactly one feature each, silently.`,
    );
  }
  log(`[payload] ${Object.keys(deps).length} runtime deps: ${Object.keys(deps).join(', ')}`);

  writeFileSync(
    join(payload, 'package.json'),
    `${JSON.stringify(
      {
        name: 'lmthing-bundle-payload',
        private: true,
        // The cli dist is ESM; the resolver walks up to this manifest.
        type: 'module',
        dependencies: deps,
      },
      null,
      2,
    )}\n`,
  );

  // npm, not pnpm: it produces a FLAT, symlink-free tree that survives being
  // tarred and extracted anywhere. pnpm's store symlinks point outside the
  // payload and would dangle the moment the tree moved.
  log('[payload] npm install (production deps)…');
  execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: payload,
    stdio: 'inherit',
    // On Windows `npm` is a .cmd shim, which `execFile` cannot spawn directly —
    // it fails with EINVAL/ENOENT naming a command that is plainly on PATH.
    shell: process.platform === 'win32',
  });

  linkWorkspacePackages(payload, ['core', 'cli', 'ui', 'auth', 'css', 'state', 'utils']);

  // ── vendored binaries ──────────────────────────────────────────────────────
  const zerostack = vendorZerostack(payload, target, log);

  const manifest = {
    target: target.id,
    entry: 'libs/cli/dist/cli/bin.js',
    appDist: 'apps/web/dist',
    // Null on a target upstream ships no zerostack for; the launcher then leaves
    // LMTHING_ZEROSTACK_BIN unset rather than pointing it at a file that is not there.
    zerostack: zerostack ? 'bin/zerostack' : null,
    deps,
  };
  writeFileSync(join(payload, 'bundle-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
