/**
 * The `libs/ui` native Metro config, in the place the `metro` CLI looks for it — so
 * `npx metro build --entry-file … --platform ios --out …` works from this package with no flags.
 * The harness (`metro/`) uses the same factory; see `metro/README.md`.
 */
module.exports = require('./metro/config.cjs').createNativeMetroConfig({ quiet: false })
