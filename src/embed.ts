import { Plivet } from './app/Plivet';
import type { PlivetOptions } from './app/Plivet';
import { assetUrl } from './app/assets';
import {
  LEGACY_MOUNT_ELEMENT_ID,
  MOUNT_ELEMENT_ID,
  findMount,
  mount,
  whenReady,
} from './app/mount';
import { CONFIG_ELEMENT_ID, parseConfig, readConfig } from './app/config';

/**
 * The application behind the deployed `c-visualizer.js` loader.
 *
 * `embed.entry.ts` is the script the loader loads and this is what it imports:
 * the split is a size limit rather than a design, and `start` is where a load
 * used to be.
 *
 * `main.ts` is the standalone page's own caller, and is bound up with
 * `index.html`, which webpack generates for it. A host page generates its own
 * markup instead - a Sphinx `interactive-code` directive writes the divs and
 * `add_js_file` writes the script tag - so what it needs is a bundle that
 * mounts itself into what it finds. The loader first makes compatible
 * CodeMirror module namespaces available, from the host or the fallback:
 *
 *     <div id="c-visualizer-config" config='{"theme": "dark"}'></div>
 *     <div id="c-visualizer"></div>
 *     <script src="_static/c-visualizer/c-visualizer.js"></script>
 *
 * The interpreter, the preprocessor dialog and the Worker stay in the chunks
 * they are already in. They are fetched from beside this script, wherever it
 * was served from, because webpack resolves its public path at run time from
 * the script element: a host copies the whole output directory into its assets
 * and includes the one file.
 *
 * The class is published on `window` as well. A directive that writes several
 * blocks into one page cannot express that as an id, so the first block is the
 * one mounted here and the extension builds the rest itself, one
 * `new CVisualizer(element, options)` per block, the way `dev.ts` does.
 */

/** The class, plus what a host needs to build further instances by hand. */
export type CVisualizerGlobal = typeof Plivet & {
  /** The instance mounted on load, or null where the page had nowhere for one. */
  instance: Plivet | null;
  /** Mount into `#c-visualizer` (or `#root`), unless that already happened. */
  mount(doc?: Document, options?: PlivetOptions): Plivet | null;
  /** What an element's `config` attribute, or its text, asks for. */
  parseConfig(text: string): PlivetOptions;
  readConfig(doc?: Document, id?: string): PlivetOptions;
  /** The ids of the markup above, so a host generator need not repeat them. */
  mountElementId: string;
  configElementId: string;
};

/**
 * What this build knows and the markup cannot say: the licence report is
 * deployed beside this script rather than beside the page. It is an option
 * rather than a change in the shell so that the standalone build keeps the
 * page-relative link it has always had.
 */
const deployed = (): PlivetOptions => ({ licenses: assetUrl('licenses.html') });

const api: CVisualizerGlobal = Object.assign(Plivet, {
  instance: null as Plivet | null,
  mount: (doc: Document = document, options: PlivetOptions = {}) =>
    mount(doc, { ...deployed(), ...options }),
  parseConfig,
  readConfig,
  mountElementId: MOUNT_ELEMENT_ID,
  configElementId: CONFIG_ELEMENT_ID,
});

/**
 * Publish the API, and mount unless the host said it would do that itself.
 *
 * Called by `embed.entry.ts`, which is the script the loader loads: this
 * module arrives in an async chunk, so what happens on load is a function
 * somebody calls rather than the evaluation of this file.
 */
export function start(autoMount = true): CVisualizerGlobal {
  (window as unknown as { CVisualizer: CVisualizerGlobal }).CVisualizer = api;

  if (autoMount) {
    whenReady(() => {
      api.instance = api.mount();
      if (api.instance === null && findMount() === null) {
        // Not thrown: a page that included the bundle and wrote no element for
        // it shows its author nothing at all, and they have no stack trace to
        // read. Say which markup is missing instead.
        console.warn(
          `c-visualizer: no element to mount into. Add ` +
            `<div id="${MOUNT_ELEMENT_ID}"></div> (or #${LEGACY_MOUNT_ELEMENT_ID}) ` +
            `to the page, and configure it with ` +
            `<div id="${CONFIG_ELEMENT_ID}" config='{...}'></div>.`
        );
      }
    });
  }

  return api;
}
