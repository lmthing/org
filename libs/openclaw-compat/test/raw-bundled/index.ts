// A RAW bundled-channel descriptor (a plain object with `plugin.specifier` and
// no `register`) — exercises loadPlugin's fallback that applies it like
// defineBundledChannelEntry's generated register would.
export default {
  id: "rawchan",
  name: "Raw Channel",
  plugin: { specifier: "./channel-plugin.js", exportName: "rawPlugin" },
  registerFull(api: any) {
    api.registerHttpRoute({
      method: "post",
      path: "/rawchan/webhook",
      handler: (req: any) => ({ status: 202, body: { raw: true, got: req.body } }),
    });
  },
};
