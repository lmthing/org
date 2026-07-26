module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // `export * as ns from '…'` is ES2020 and the shared `chat/index.ts` uses it, but
      // `@react-native/babel-preset` does not enable this transform — so without it the chat barrel
      // is untransformable for native while being valid everywhere else. The Metro harness enables
      // the same plugin (`libs/ui/metro/transformer.cjs`); a green harness says nothing about THIS
      // build unless the app enables it too, which is the whole reason the line is here.
      '@babel/plugin-transform-export-namespace-from',
    ],
  }
}
