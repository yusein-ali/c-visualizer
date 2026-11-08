/**
 * PLIVET's frame: the two-column layout - stacked into one column when its
 * container is narrow - and the boxes the editor, console, controls, file
 * panel and visualization mount into.
 *
 * Nothing under this directory may import from `src/app/`. The shell is told
 * what to show and reports what was clicked; the wiring is the caller's.
 */
export { LAYOUT_HYSTERESIS, PlivetShell, STACKED_BELOW } from './PlivetShell';
export type {
  PlivetShellOptions,
  ShellLayout,
  ShellLayoutMode,
} from './PlivetShell';
export { Splitter } from './Splitter';
export type { SplitterAxis, SplitterOptions } from './Splitter';
