/**
 * The entry `npm run deploy` builds into `c-stdio.js`: one small script with
 * no interpreter, no worker and no chunks, which publishes the formatter and
 * the scanner on the page.
 *
 * `CStdioReady` is there for symmetry with `CVisualizerReady`: a host that
 * loads the script with `async` awaits the promise rather than polling for the
 * global. The script has nothing to load after itself, so it is resolved by
 * the time anyone can read it.
 */
import { createStdio, CStdio } from './stdio';

type StdioWindow = Window &
  typeof globalThis & {
    CStdio?: CStdio;
    CStdioReady?: Promise<CStdio>;
  };

const scope = window as StdioWindow;
const api = createStdio();
scope.CStdio = api;
scope.CStdioReady = Promise.resolve(api);
