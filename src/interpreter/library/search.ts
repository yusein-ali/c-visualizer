import { Engine } from 'unicoen.ts/dist/interpreter/Engine/Engine';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { LibraryHost } from './host';
import { Memory, num, sizeArg } from './memory';

/**
 * `qsort` and `bsearch`, calling the program's comparison function as
 * interpreted code.
 *
 * Both are generators, which is how a library function can do what `scanf`
 * does when it waits for input: hand the engine steps. Every call of the
 * comparator runs through the engine's own function call, so stepping into
 * `qsort` steps through the comparator's statements, its frame is drawn with
 * its two pointers' arrows on the elements being compared, and the call
 * stack shows it called from the `qsort` line.
 *
 * The sort is an insertion sort by adjacent swaps - the simplest sort that is
 * stable, and the one whose every move is a swap of two neighbours. Each swap
 * is two ordinary writes, so the array on the canvas is seen being sorted,
 * and the mutation view records the whole call as the array before and after.
 * `bsearch` is the textbook binary search, comparing the key with the middle
 * element.
 *
 * An array of records is moved member by member, because a record here is a
 * descriptor word and its members rather than a run of bytes; the element
 * size the program passes is still the `sizeof` it sees, and is checked
 * against the array's element type.
 */

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/** The array a call is handed: where each element is and how to swap two. */
interface Elements {
  count: number;
  address(index: number): number;
  swap(left: number, right: number): void;
}

export function installSearch(global: Scope, host: LibraryHost): void {
  const memory = new Memory(host);
  const define = (name: string, fn: (...args: any[]) => unknown): void =>
    global.setTop(name, fn, 'FUNCTION');

  const swapCells = (
    fn: string,
    left: { address: number }[],
    right: { address: number }[]
  ): void => {
    const held = left.map((cell) => global.objectOnMemory.get(cell.address));
    right.forEach((cell, i) => {
      if (i < left.length) {
        host.write(
          left[i].address,
          global.objectOnMemory.get(cell.address),
          fn
        );
        host.write(cell.address, held[i], fn);
      }
    });
  };

  const elementsOf = (
    fn: string,
    base: unknown,
    rawCount: unknown,
    rawSize: unknown
  ): Elements => {
    const count = sizeArg(rawCount);
    const size = sizeArg(rawSize);
    if (count === 0) {
      return { count, address: () => 0, swap: () => undefined };
    }
    const start = memory.pointer(base, fn, 'the array');
    const misfit = (type: string, width: number): never =>
      host.refuse(
        'element-size',
        `${fn} was told each element is ${plural(size, 'byte')}, but the ` +
          `array holds ${type} elements of ${plural(width, 'byte')}; pass ` +
          `sizeof the element type`
      );
    const record = memory.recordAt(start);
    if (record !== null) {
      if (size !== host.recordSize(record)) {
        misfit(record, host.recordSize(record));
      }
      const stride = host.recordStride(record);
      memory.region(start, count * stride, fn, 'the array', fn === 'qsort');
      const at = (index: number): number => start + index * stride;
      return {
        count,
        address: at,
        swap: (left, right) =>
          swapCells(
            fn,
            host.recordCells(record, at(left)),
            host.recordCells(record, at(right))
          ),
      };
    }
    const type = global.typeOnMemory.get(start);
    if (typeof type === 'undefined' || !global.objectOnMemory.has(start)) {
      host.refuse(
        'invalid-pointer',
        `${fn} was given a pointer as the array that does not point to an object`
      );
    }
    const width = Engine.sizeof(type);
    if (size !== width) {
      misfit(type, width);
    }
    memory.region(start, count * size, fn, 'the array', fn === 'qsort');
    const at = (index: number): number => start + index * size;
    return {
      count,
      address: at,
      swap: (left, right) =>
        swapCells(fn, [{ address: at(left) }], [{ address: at(right) }]),
    };
  };

  /** One call of the comparator, as the sign of what it returned. */
  function* order(
    fn: string,
    compare: (args: unknown[]) => Generator<unknown, unknown, unknown>,
    left: number,
    right: number
  ): Generator<unknown, number, unknown> {
    const result = num(yield* compare([left, right]));
    if (Number.isNaN(result)) {
      host.warn(
        'comparison-result',
        `the comparison function given to ${fn} returned no value; it must ` +
          `return a negative int, zero or a positive int`
      );
      return 0;
    }
    return Math.sign(result);
  }

  define(
    'qsort',
    function* (base: unknown, n: unknown, size: unknown, cmp: unknown) {
      const elements = elementsOf('qsort', base, n, size);
      const compare = host.callback(cmp, 'qsort', 'the comparison function');
      for (let i = 1; i < elements.count; i += 1) {
        for (let j = i; j > 0; j -= 1) {
          const sign = yield* order(
            'qsort',
            compare,
            elements.address(j - 1),
            elements.address(j)
          );
          if (sign <= 0) {
            break;
          }
          elements.swap(j - 1, j);
        }
      }
    }
  );

  define(
    'bsearch',
    function* (
      key: unknown,
      base: unknown,
      n: unknown,
      size: unknown,
      cmp: unknown
    ) {
      const target = Array.isArray(key)
        ? host.literalAddress(key.map((byte) => num(byte) & 0xff))
        : memory.pointer(key, 'bsearch', 'the key');
      const elements = elementsOf('bsearch', base, n, size);
      const compare = host.callback(cmp, 'bsearch', 'the comparison function');
      let low = 0;
      let high = elements.count - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const sign = yield* order(
          'bsearch',
          compare,
          target,
          elements.address(middle)
        );
        if (sign === 0) {
          return elements.address(middle);
        }
        if (sign < 0) {
          high = middle - 1;
        } else {
          low = middle + 1;
        }
      }
      return 0;
    }
  );
}
