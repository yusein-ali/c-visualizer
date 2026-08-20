import { EventEmitter } from 'events';
import type { CONTROL_EVENT, DEBUG_STATE, StepModel } from '../core';
import type { Theme } from './theme';
import type { ZOOM_COMMAND } from '../ui/controls';

/**
 * The application's event bus.
 *
 * One module-level emitter, which is what Phase 10 changes: an instance
 * constructs its own bus and passes it to its widgets, so that two PLIVETs on
 * one page cannot step each other. Until then this is the single instance the
 * page has always had, and the event union below is the registry - an event
 * that is not in it does not exist.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(20);

export type event =
  | 'debug'
  | 'changeTheme'
  | 'changeState'
  | 'changeOutput'
  | 'zoom'
  | 'draw';

/**
 * What each event carries. The signatures were `any[]` while React components
 * unpacked them by hand; naming them here is what lets the compiler check a
 * `signal` against the `slot` that answers it.
 */
export interface EventPayloads {
  debug: [command: CONTROL_EVENT, stdinText?: string];
  changeTheme: [theme: Theme];
  changeState: [debugState: DEBUG_STATE, step: number];
  changeOutput: [output: string];
  /** The editor's text size, not the visualization's scale. */
  zoom: [command: ZOOM_COMMAND];
  draw: [model: StepModel];
}

export const slot = <E extends event>(
  event: E,
  listener: (...args: EventPayloads[E]) => void
): EventEmitter => emitter.on(event, listener as (...args: any[]) => void);

export const signal = <E extends event>(
  event: E,
  ...args: EventPayloads[E]
): boolean => emitter.emit(event, ...args);
