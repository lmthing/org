/**
 * The platforms a bundled `lmthing` can be built for, and where the vendored
 * binaries come from for each.
 *
 * ## Windows is a REDUCED target, and says so
 *
 * Neither vendored binary exists for it: zerostack publishes only `*-apple-darwin`
 * and `*-unknown-linux-{gnu,musl}` assets, and Lightpanda only
 * `{x86_64,aarch64}-{linux,macos}`. The CLI itself runs there perfectly well, so
 * the bundle is still worth shipping — but it carries neither the coding agent nor
 * the browser, and `zerostack: false` below is what makes that a declared property
 * of the target rather than a build that quietly succeeds with a gap in it.
 *
 * Both absences are already honest at runtime: the zerostack endpoint reports the
 * binary as not installed, and `lightpandaAssetName` returns undefined for win32 so
 * the installer says upstream publishes no build rather than 404ing on a URL it
 * invented.
 *
 * ## Why each target builds on its own runner
 *
 * The executable is Node's own binary with a payload appended (`node:sea`), so it
 * IS the host runner's Node. There is no cross-compilation step to get wrong, and
 * `useCodeCache` stays available (V8 bytecode is architecture-specific and would
 * be silently rejected — or worse, accepted — if generated on the wrong host).
 * The cost is one runner per target; `.github/workflows/cli-bundle.yml` pins them.
 */

/**
 * zerostack is pinned to an exact version for the same reason the compute image
 * pins it (`devops/argocd/compute/Dockerfile`): it executes model-authored code
 * against the person's entire data directory, so a change in its behaviour or
 * permission handling is not something to inherit from an unrelated rebuild.
 *
 * The FULL asset, never `zerostack-lite-*`: upstream builds the lite one with
 * `--no-default-features`, dropping `mcp`, `subagents`, `loop` and
 * `git-worktree`. `zerostackLoop` drives `--loop`, so the lite binary fails at
 * the flag with "unknown argument" rather than anything naming the cause.
 */
export const ZEROSTACK_VERSION = 'v1.7.2';

/**
 * Lightpanda deliberately does not appear in this file.
 *
 * It is not embedded (156 MB, and most runs never browse), so nothing here needs
 * to fetch it — and the URL it is fetched from at runtime is derived from
 * `process.platform`/`process.arch` by `src/browser/lightpanda-install.ts`, which
 * is correct because a bundle only ever runs on the platform it was built for.
 * A second copy of that asset-name table here would be one more thing to forget.
 */

/**
 * `-gnu` rather than `-musl` for zerostack on Linux: the binary is spawned by a
 * Node process on whatever distro the person runs, and the gnu build is the one
 * upstream tests. musl would be the right choice only if we controlled the base
 * image, which is the compute pod's situation and not this one.
 */
const ZS_TRIPLE = {
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  // No upstream Windows asset. Null, not missing, so a reader sees the decision.
  'win32-x64': null,
};

/** Every target the bundle can be built for, keyed by `<node platform>-<node arch>`. */
export const TARGETS = Object.fromEntries(
  Object.entries(ZS_TRIPLE).map(([id, triple]) => {
    const [platform, arch] = id.split('-');
    return [
      id,
      {
        id,
        platform,
        arch,
        /** Windows executables need the suffix or they will not run. */
        exeSuffix: platform === 'win32' ? '.exe' : '',
        /** Whether the coding agent ships inside this target's payload. */
        zerostack: triple !== null,
        zerostackUrl: triple
          ? `https://github.com/gi-dellav/zerostack/releases/download/${ZEROSTACK_VERSION}/zerostack-${triple}.tar.gz`
          : null,
      },
    ];
  }),
);

/** The target matching the host this script is running on. */
export function hostTarget() {
  return `${process.platform}-${process.arch}`;
}

/**
 * Resolve a target id, defaulting to the host. Throws with the full list rather
 * than falling back: building "some other platform's" bundle because a typo did
 * not match is a failure that only shows up when someone runs the artifact.
 */
export function resolveTarget(id = hostTarget()) {
  const t = TARGETS[id];
  if (!t) {
    throw new Error(`unknown bundle target "${id}" — known targets: ${Object.keys(TARGETS).join(', ')}`);
  }
  return t;
}
