/**
 * PLIVET's console: the program's output, and the standard input it blocks
 * on.
 *
 * Like `src/ui/editor`, nothing under this directory may import from
 * `src/app/`. It has no dependencies at all beyond the DOM and its own
 * stylesheet, which it brings with it so that a host page needs to register
 * nothing alongside it.
 */
export { PlivetConsole } from './PlivetConsole';
export type { PlivetConsoleOptions } from './PlivetConsole';
