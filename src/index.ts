/**
 * c-visualizer's public surface: one class, and the options it takes.
 *
 * Everything else - the widgets, the bus, the interpreter client - is reached
 * through an instance, so an embedding page imports this and nothing deeper.
 * The legacy names remain aliases so existing PLIVET integrations keep working.
 * `src/main.ts` is the standalone page's own use of it, and is what
 * `index.html` loads; the Sphinx extension will construct its own
 * instances the same way, one per directive on the page.
 */
export { Plivet, Plivet as CVisualizer } from './app/Plivet';
export type {
  PlivetControls,
  PlivetControls as CVisualizerControls,
  PlivetFeatures,
  PlivetFeatures as CVisualizerFeatures,
  PlivetLayout,
  PlivetLayout as CVisualizerLayout,
  PlivetLayoutMode,
  PlivetLayoutMode as CVisualizerLayoutMode,
  PlivetOptions,
  PlivetOptions as CVisualizerOptions,
} from './app/Plivet';
export type {
  EditableRegionsOption,
  FileEditableLines,
  LoadOrigin,
  LoadRefusal,
} from './app/protection';
export {
  CONFIG_ATTRIBUTE,
  CONFIG_ELEMENT_ID,
  parseConfig,
  readConfig,
} from './app/config';
export {
  LEGACY_MOUNT_ELEMENT_ID,
  MOUNT_ELEMENT_ID,
  findMount,
  mount,
  whenReady,
} from './app/mount';
export type { ViewSelection } from './core';
export type { Theme } from './app/theme';
export type {
  DocumentSessionJSON,
  EditableRegion,
  LineRange,
  ProgramSessionJSON,
  SessionFileJSON,
  SessionJSON,
  SessionSelection,
  SessionWatch,
} from './ui/editor';
export type { SourceFile } from './core';
export type {
  CodeMirrorConfig,
  CodeMirrorSettings,
  CodeMirrorThemeName,
  DiagnosticOptions,
  DiagnosticProvider,
  ExternalDiagnostic,
  ProtectedSpan,
  SnapshotFile,
  SourcePosition,
  SourceSnapshot,
  Unsubscribe,
} from './app/host';
export { codeMirrorSettings } from './app/host';
export {
  LIBRARY_MANIFEST_VERSION,
  libraryManifest,
} from './app/libraryManifest';
export type {
  LibraryManifest,
  ManifestFunction,
  ManifestMacro,
  ManifestObject,
  ManifestRefused,
  ManifestType,
} from './app/libraryManifest';
export { REFUSED_CONSTRUCTS } from './interpreter/refused';
export type {
  RefusedConstruct,
  RefusedConstructId,
} from './interpreter/refused';
export { joinArgs, splitArgs } from './app/programArgs';
