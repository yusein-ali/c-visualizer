import { Bus } from '../src/app/emitter';
import { emptyStepModel } from '../src/core';

describe('the bus', () => {
  it('delivers a signal to every slot that answers it', () => {
    const bus = new Bus();
    const seen: Array<[string, number]> = [];
    bus.slot('changeState', (state, step) => seen.push([state, step]));
    bus.slot('changeState', (state, step) => seen.push([`2:${state}`, step]));
    bus.slot('changeOutput', () => seen.push(['output', 0]));

    bus.signal('changeState', 'Debugging', 3);

    expect(seen).toEqual([
      ['Debugging', 3],
      ['2:Debugging', 3],
    ]);
  });

  it('carries a signal nobody listens for', () => {
    const bus = new Bus();
    expect(() => bus.signal('draw', emptyStepModel())).not.toThrow();
  });

  /** Phase 10's point: one page, two buses, and no path between them. */
  it('does not reach another instance', () => {
    const one = new Bus();
    const other = new Bus();
    const heard: string[] = [];
    one.slot('debug', (command) => heard.push(`one:${command}`));
    other.slot('debug', (command) => heard.push(`other:${command}`));

    one.signal('debug', 'Step');
    other.signal('debug', 'Stop');

    expect(heard).toEqual(['one:Step', 'other:Stop']);
  });

  it('walks the slots a signal had when it was sent', () => {
    const bus = new Bus();
    const heard: string[] = [];
    bus.slot('debug', () => {
      heard.push('first');
      // Subscribing from inside a listener: the new slot answers the next
      // signal, and must not be called by the one already being delivered.
      bus.slot('debug', () => heard.push('late'));
    });

    bus.signal('debug', 'Step');
    expect(heard).toEqual(['first']);
    // The second signal reaches both, and subscribes a third that will only
    // be heard by the next one.
    bus.signal('debug', 'Step');
    expect(heard).toEqual(['first', 'first', 'late']);
  });

  it('goes quiet when it is destroyed', () => {
    const bus = new Bus();
    const heard: string[] = [];
    bus.slot('debug', (command) => heard.push(command));

    bus.signal('debug', 'Step');
    bus.destroy();
    bus.signal('debug', 'Step');

    expect(heard).toEqual(['Step']);
  });
});
