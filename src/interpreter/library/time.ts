import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { LIBRARY_CONSTANTS } from './constants';
import { LibraryHost } from './host';
import { Memory, cInt, num } from './memory';
import { LIBRARY_TYPEDEFS } from './types';

/**
 * `<time.h>`: `time`, `clock` and `difftime`.
 *
 * `time` is the wall clock, so `srand(time(NULL))` seeds differently on
 * every run, as it does anywhere else. `clock` counts the real time since
 * the program started rather than processor time: a step debugger spends
 * most of a run waiting for the reader, and no interpreter-side measure of
 * "processor time" would mean more than this does. It is a teaching
 * approximation, and the hover help says so.
 */
export function installTime(global: Scope, host: LibraryHost): void {
  const memory = new Memory(host);
  const define = (name: string, fn: (...args: any[]) => unknown): void =>
    global.setTop(name, fn, 'FUNCTION');
  const now = (): number =>
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const started = now();
  const perSecond = LIBRARY_CONSTANTS.CLOCKS_PER_SEC.value;

  define('time', (timer: unknown) => {
    const seconds = Math.floor(Date.now() / 1000);
    if (typeof timer !== 'undefined' && !memory.isNull(timer)) {
      const at = memory.pointer(timer, 'time', 'its argument');
      memory.region(
        at,
        LIBRARY_TYPEDEFS.time_t.bytes,
        'time',
        'its argument',
        true
      );
      host.write(at, cInt(seconds), 'time');
    }
    return cInt(seconds);
  });

  define('clock', () =>
    cInt(Math.round(((now() - started) / 1000) * perSecond))
  );

  define('difftime', (end: unknown, start: unknown) => num(end) - num(start));
}
