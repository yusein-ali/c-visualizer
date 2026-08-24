/**
 * The fixed-name script the loader addresses, and nothing else.
 *
 * `c-visualizer.app.js` has to keep its name, because `embed.loader.ts` writes
 * that name into a script tag. It also has to stay under the static asset-size
 * limit course pages are held to, and the application is nine hundred kilobytes.
 * Those two requirements are only compatible if the application is loaded
 * rather than linked: webpack splits an entry chunk that exceeds `maxSize`
 * into `c-visualizer.app-<hash>.js` parts and leaves nothing under the name the
 * loader asks for, whereas the parts of an async chunk are fetched by the
 * runtime that knows their names. So this entry is the runtime plus one
 * `import()`, and the size limit applies to chunks nobody has to address by
 * hand.
 *
 * `document.currentScript` is read here rather than in `embed.ts`: it is this
 * file that the browser evaluates while the script tag is executing, and it is
 * null by the time the imported chunk runs.
 *
 * The application publishes `window.CVisualizer` when its chunk arrives, which
 * is after this script's `load` event. The loader cannot wait on `load` alone
 * then, so what it waits on is the promise published here.
 */
import type { CVisualizerGlobal } from './embed';

const script = document.currentScript;

const autoMount =
  !(script instanceof HTMLScriptElement) ||
  script.dataset.cVisualizerAutoMount !== 'false';

const ready: Promise<CVisualizerGlobal> = import('./embed').then((module) =>
  module.start(autoMount)
);

(
  window as unknown as { CVisualizerApp: Promise<CVisualizerGlobal> }
).CVisualizerApp = ready;

ready.catch((error: unknown) => console.error(error));
