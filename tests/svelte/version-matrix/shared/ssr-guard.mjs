// Imported before the production Kit adapter server loads the route modules.
// Node has no window/document/canvas/WebGL; constructing a browser scene on SSR fails.
globalThis.fetch = (...args) => {
  throw new Error(`Matrix SSR unexpectedly initiated fetch: ${String(args[0])}`);
};
