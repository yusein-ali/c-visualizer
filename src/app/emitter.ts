import type { CONTROL_EVENT, DEBUG_STATE, StepModel } from '../core';
import type { StatementExplanation } from '../ui/records';
import type { MemoryNavigationTarget } from '../ui/graph';
import type { Theme } from './theme';
import type { ZOOM_COMMAND } from '../ui/controls';

export type event =
  | 'debug'
  | 'changeTheme'
  | 'changeState'
  | 'changeOutput'
  | 'zoom'
  | 'draw'
  | 'focusObject'
  | 'navigateMemory';

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
  /**
   * The step to draw, and what its statement is doing. The two travel
   * together because they are one picture: the canvas draws the memory and,
   * under it, a reading of the statement that moved it.
   */
  draw: [model: StepModel, explanation: StatementExplanation];
  /**
   * The object the reader is pointing at, and which panel they are pointing
   * from. The origin is what stops the two panels answering each other: a
   * side ignores what it said itself, and marks what the other one says.
   */
  focusObject: [object: string | null, origin: 'editor' | 'graph'];
  /** A memory row the editor should reveal in source. */
  navigateMemory: [target: MemoryNavigationTarget];
}

type Listener = (...args: any[]) => void;

/**
 * One PLIVET's event bus, and the registry of what it may carry.
 *
 * It was a module-level Node `EventEmitter` - one bus for the page, which is
 * what Phase 10 changes. An instance constructs its own and passes it to the
 * pieces it wires together, so two PLIVETs on one page cannot step, redraw or
 * re-theme each other. That also retires `setMaxListeners(20)`: the count was
 * only ever over the default because every instance's subscriptions landed on
 * the same emitter.
 *
 * The `events` polyfill went with it. A browser-only widget has no reason to
 * ship Node's emitter to say `on` and `emit`, and the class it left behind is
 * the typed pair the application actually used.
 *
 * Subscriptions are still made in constructors and never removed one at a
 * time; `destroy()` drops all of them at once, which is how an instance stops
 * hearing about a page it has been unmounted from.
 */
export class Bus {
  private readonly listeners = new Map<event, Listener[]>();

  /** Subscribe. The listener is checked against the payload declared above. */
  slot<E extends event>(
    event: E,
    listener: (...args: EventPayloads[E]) => void
  ): void {
    const listeners = this.listeners.get(event);
    if (listeners === undefined) {
      this.listeners.set(event, [listener as Listener]);
      return;
    }
    listeners.push(listener as Listener);
  }

  /** Emit. Answered by whatever had subscribed when the signal was sent. */
  signal<E extends event>(event: E, ...args: EventPayloads[E]): void {
    const listeners = this.listeners.get(event);
    if (listeners === undefined) {
      return;
    }
    // Over a copy: a listener that subscribes or unsubscribes while it is
    // being called must not change the list this loop is walking.
    for (const listener of listeners.slice()) {
      listener(...args);
    }
  }

  destroy(): void {
    this.listeners.clear();
  }
}
