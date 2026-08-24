/**
 * The one line webpack needs to find the Worker.
 *
 * `new URL(..., import.meta.url)` is what makes the Worker a bundled entry
 * point rather than a path resolved at runtime, and it is why the application
 * has to be served over http(s): a `file://` page has no origin to load it
 * from. It lives alone in this file because `import.meta` is module syntax
 * that a CommonJS build cannot express, and the tests run under one.
 */
export const spawnWorker = (): Worker =>
  new Worker(new URL('./interpreter.worker.ts', import.meta.url), {
    // Course pages and their static assets may be served from different
    // origins. The static host deliberately answers with
    // Access-Control-Allow-Origin: *, which cannot be used with the default
    // credential mode for a cross-origin worker request.
    credentials: 'omit',
  });
