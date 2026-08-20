/**
 * PLIVET's public surface: one class, and the options it takes.
 *
 * Everything else - the widgets, the bus, the interpreter client - is reached
 * through an instance, so a page that embeds PLIVET imports this and nothing
 * deeper. `src/main.ts` is the standalone page's own use of it, and is what
 * `index.html` loads; the Sphinx extension of Phase 13 will construct its own
 * instances the same way, one per directive on the page.
 */
export { Plivet } from './app/Plivet';
export type { PlivetOptions } from './app/Plivet';
export type { Theme } from './app/theme';
