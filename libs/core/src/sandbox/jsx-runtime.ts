/**
 * Injects a virtual JSX factory into the QuickJS VM so that JSX the model
 * writes produces plain descriptor objects { type, props, children } rather
 * than React elements.
 */
export const JSX_RUNTIME_CODE = `
const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat() };
  },
  Fragment: 'Fragment',
};
const jsx = React.createElement;
const jsxs = React.createElement;
const Fragment = React.Fragment;
`;
