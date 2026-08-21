/**
 * c-visualizer's public surface: one class, and the options it takes.
 *
 * Everything else - the widgets, the bus, the interpreter client - is reached
 * through an instance, so an embedding page imports this and nothing deeper.
 * The legacy names remain aliases so existing PLIVET integrations keep working.
 * `src/main.ts` is the standalone page's own use of it, and is what
 * `index.html` loads; the Sphinx extension of Phase 13 will construct its own
 * instances the same way, one per directive on the page.
 */
export { Plivet, Plivet as CVisualizer } from './app/Plivet';
export type {
  PlivetFeatures,
  PlivetFeatures as CVisualizerFeatures,
  PlivetOptions,
  PlivetOptions as CVisualizerOptions,
} from './app/Plivet';
export type { Theme } from './app/theme';
export type { EditableRegion, SessionJSON } from './ui/editor';
export type { SourceFile } from './core';
