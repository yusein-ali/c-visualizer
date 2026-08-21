import { Plivet } from './Plivet';
import type { PlivetOptions } from './Plivet';
import { readConfig } from './config';

/**
 * Where c-visualizer puts itself when nobody hands it an element.
 *
 * `main.ts` used to read `#root` directly, which was fine while the only page
 * was ours. A deployed bundle is included into somebody else's page - a Sphinx
 * `_static` script beside a course chapter, a Moodle block - and `root` is a
 * name that page may already be using for its own frame. So the element the
 * bundle looks for is named after the thing that mounts into it, next to the
 * configuration element it already had:
 *
 *     <div id="c-visualizer-config" config='{"theme": "dark"}'></div>
 *     <div id="c-visualizer"></div>
 *     <script src="_static/c-visualizer/c-visualizer.js"></script>
 *
 * `#root` is still read when `#c-visualizer` is absent, so `src/index.html`
 * and every page written against it keep working unchanged.
 *
 * Nothing here holds state between calls: the mounting is a function of the
 * document, and a page with two instances builds them with `new Plivet` as
 * `dev.ts` does. What is remembered is written on the element itself, so that
 * a bundle included twice - which is easy to do by accident when a host
 * generator registers assets per directive - mounts once.
 */

/** The element the bundle mounts into. */
export const MOUNT_ELEMENT_ID = 'c-visualizer';

/** What the standalone page has always called it. Read when the above is absent. */
export const LEGACY_MOUNT_ELEMENT_ID = 'root';

/** Written on an element already carrying an instance. */
const MOUNTED_ATTRIBUTE = 'data-c-visualizer-mounted';

/** The element to build in, or null where the page provides none. */
export function findMount(doc: Document = document): HTMLElement | null {
  return (
    doc.getElementById(MOUNT_ELEMENT_ID) ??
    doc.getElementById(LEGACY_MOUNT_ELEMENT_ID)
  );
}

/**
 * One instance, in the element the page provides, configured the way the page
 * asked for. Null means there was nothing to mount into, or something already
 * is: neither is an error a course page can act on, so neither throws.
 *
 * `options` is what the caller knows and the markup cannot say - the embed
 * entry passes the licence report's address, which depends on where the bundle
 * was served from. The page's own configuration wins over it, because the
 * whole point of the configuration element is that the page has the last word.
 */
export function mount(
  doc: Document = document,
  options: PlivetOptions = {}
): Plivet | null {
  const element = findMount(doc);
  if (element === null) {
    return null;
  }
  if (element.hasAttribute(MOUNTED_ATTRIBUTE)) {
    return null;
  }
  element.setAttribute(MOUNTED_ATTRIBUTE, '');
  return new Plivet(element, { ...options, ...readConfig(doc) });
}

/**
 * Run once the elements exist.
 *
 * A host generator decides where the script tag goes, and Sphinx's
 * `add_js_file` puts it in the head: the bundle is executed before the body it
 * is meant to mount into has been parsed. A page that includes it at the end
 * of the body, or with `defer`, is already past `loading` and runs straight
 * away.
 */
export function whenReady(run: () => void, doc: Document = document): void {
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', () => run(), { once: true });
    return;
  }
  run();
}
