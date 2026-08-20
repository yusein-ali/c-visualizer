/**
 * PLIVET's debug controls, and the table that says which of them a debug state
 * enables.
 *
 * `enablementFor` is deliberately separate from the bar that renders it: it is
 * the only logic in this directory, it is what the tests check, and a host
 * page that draws its own buttons still needs the answer.
 */
export { ControlBar } from './ControlBar';
export type { ControlBarOptions, ZOOM_COMMAND } from './ControlBar';
export { enablementFor, isLive, runCommand, stepCommand } from './enablement';
export type { Enablement } from './enablement';
