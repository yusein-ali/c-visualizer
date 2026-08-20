/**
 * PLIVET's frame: the two-column layout, and the boxes the editor, console,
 * controls, file panel and visualization mount into.
 *
 * Nothing under this directory may import from `src/app/`. The shell is told
 * what to show and reports what was clicked; the wiring is the caller's.
 */
export { PlivetShell } from './PlivetShell';
export type { PlivetShellOptions } from './PlivetShell';
