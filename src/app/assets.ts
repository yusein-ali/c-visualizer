/**
 * Where the files shipped beside the bundle actually are.
 *
 * The footer links to `licenses.html`, and standalone that is next to the page
 * that loaded it. Embedded it is not: the page is a course chapter somewhere
 * in a documentation tree and the report sits with the script, under Sphinx's
 * `_static`. What both have in common is the bundle's own address, which
 * webpack knows as the public path and works out at run time from the script
 * element it was loaded by - the same value the interpreter chunks and the
 * Worker are fetched with.
 *
 * `__webpack_public_path__` is a webpack module variable rather than a real
 * global, so it is not there in Jest's CommonJS build - the same reason
 * `spawnWorker` lives alone in a file of its own. Reading it is guarded rather
 * than declared away: under a test, and under any build that never set one,
 * this falls back to the page-relative address the standalone page has always
 * used.
 */

declare const __webpack_public_path__: string;

export function assetUrl(name: string): string {
  let base = '';
  try {
    base = __webpack_public_path__;
  } catch {
    base = '';
  }
  if (base === '' || base === 'auto') {
    return `./${name}`;
  }
  return `${base}${name}`;
}
