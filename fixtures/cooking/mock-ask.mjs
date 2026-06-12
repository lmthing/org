// Keyless mock: drive the chef to ask() with the ConfirmDish form component,
// then display the confirmed result. Used to verify space-form rendering +
// submission in the web UI.
export default function handler(opts, ctx) {
  const i = ctx.callIndex;
  if (i === 0) return `const ok = await ask(<ConfirmDish dish="spaghetti" />);`;
  if (i === 1) return `display("confirmed=" + ok);`;
  return '';
}
