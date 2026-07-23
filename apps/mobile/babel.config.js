module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // The Tamagui optimizing compiler for native — extracts styles at build time and drives the
      // same tamagui.config the web target uses. `config` points at the shared config shell.
      [
        '@tamagui/babel-plugin',
        {
          components: ['@lmthing/ui'],
          config: '../../libs/ui/src/theme/tamagui.config.ts',
          logTimings: true,
        },
      ],
    ],
  }
}
