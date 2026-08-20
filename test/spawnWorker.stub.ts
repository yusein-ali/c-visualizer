/**
 * There is no Worker under Jest. `src/core/spawnWorker.ts` is replaced by this
 * (see `moduleNameMapper` in `jest.config.js`) so that importing `src/core`
 * does not drag `import.meta` into a CommonJS build. A test that means to
 * exercise the interpreter uses `Server` directly, on this thread.
 */
export const spawnWorker = (): Worker => {
  throw new Error('no Worker under Jest: use Server directly');
};
