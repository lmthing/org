// Synthetic WEBHOOK-MODE bundled channel fixture. Mirrors a real @openclaw/*
// channel entry (defineBundledChannelEntry with plugin/runtime specifiers) but
// keeps its inbound path as a plain webhook route mounted by registerFull — so
// it exercises the compat loading path WITHOUT a Socket-Mode runtime.
import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "fakechan",
  name: "Fake Channel",
  description: "synthetic webhook-mode bundled channel",
  importMetaUrl: "file:///fake/index.ts",
  // These lazy refs point at a Socket-Mode / native runtime that this host must
  // NOT load — their modules deliberately do not exist in the fixture.
  plugin: { specifier: "./channel-plugin.js", exportName: "fakePlugin" },
  runtime: { specifier: "./runtime-setter.js", exportName: "setFakeRuntime" },
  // Webhook-mode hook: note NO `method` (OpenClaw route shape) and a logger call.
  registerFull(api: any) {
    api.logger.info("fakechan registerFull ran");
    api.registerHttpRoute({
      path: "/fakechan/webhook",
      auth: "plugin",
      match: "exact",
      handler: (req: any) => ({ status: 200, body: { ok: true, got: req.body } }),
    });
  },
});
