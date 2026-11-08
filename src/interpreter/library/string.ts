import { Engine } from 'unicoen.ts/dist/interpreter/Engine/Engine';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { LibraryHost } from './host';
import {
  Memory,
  StringArg,
  cInt,
  decodeValue,
  encodeValue,
  num,
  sizeArg,
} from './memory';

/**
 * `<string.h>`.
 *
 * Every write goes through `Memory.writeBytes`, and so through the engine:
 * the canvas shows each byte a `strcpy` or a `memset` stored, the
 * uninitialised-read check counts it as written, and a `const` array or a
 * string literal refuses it. What C leaves undefined stops the program with
 * a diagnostic instead of producing a plausible wrong answer: writing past
 * the end of the destination, reading a string that has no terminator
 * inside its object, a null pointer argument, and copying between
 * overlapping objects with anything but `memmove`.
 *
 * A pointer the function returns points into the argument it was found in.
 * A string literal the engine never wrote out (the engine passes
 * `"text"` as its bytes, not as an address) is given its place in read-only
 * memory first, so `strchr("hello", 'l')` returns an address the canvas can
 * draw an arrow to.
 *
 * `strlen`, `strcpy`, `strcat` and `strcmp` replace the upstream versions,
 * which wrote past the end of their destination without a word, counted any
 * character above 127 twice, and stopped reading a string at the first
 * object that was not a number.
 */

/** glibc's wording for the error numbers `<errno.h>` defines here. */
const ERROR_MESSAGES: Record<number, string> = {
  0: 'Success',
  1: 'Operation not permitted',
  2: 'No such file or directory',
  22: 'Invalid argument',
  33: 'Numerical argument out of domain',
  34: 'Numerical result out of range',
};

export function strerrorText(errnum: number): string {
  const text = ERROR_MESSAGES[errnum];
  return typeof text === 'undefined' ? `Unknown error ${errnum}` : text;
}

const toBytes = (text: string): number[] =>
  Array.from(text, (c) => c.charCodeAt(0) & 0xff);

export function installString(global: Scope, host: LibraryHost): void {
  const memory = new Memory(host);
  const define = (name: string, fn: (...args: any[]) => unknown): void =>
    global.setTop(name, fn, 'FUNCTION');

  /** A destination argument: an address that may be written through. */
  const destination = (value: unknown, fn: string): number => {
    if (Array.isArray(value) || typeof value === 'string') {
      host.refuse(
        'string-literal-modification',
        `${fn} would write into a string literal, which cannot be modified; ` +
          `copy it into a char array first`
      );
    }
    return memory.pointer(value, fn, 'the destination');
  };

  /** Any pointer argument as an address, a literal given its place. */
  const addressOf = (value: unknown, fn: string, what: string): number => {
    if (Array.isArray(value)) {
      return host.literalAddress(value.map((byte) => num(byte) & 0xff));
    }
    if (typeof value === 'string') {
      return host.literalAddress(toBytes(value).concat([0]));
    }
    return memory.pointer(value, fn, what);
  };

  const overlapping = (
    from: number | null,
    fromLength: number,
    to: number,
    toLength: number
  ): boolean => from !== null && from < to + toLength && to < from + fromLength;

  const refuseOverlap = (fn: string): never =>
    host.refuse(
      'overlapping-copy',
      `${fn} copies between overlapping bytes, which C leaves undefined; ` +
        `memmove is the function that copies between overlapping objects`
    );

  /** C's comparison: the first differing byte decides, as unsigned char. */
  const compare = (a: number[], b: number[], limit: number): number => {
    for (let i = 0; i < limit; i += 1) {
      const left = i < a.length ? a[i] : 0;
      const right = i < b.length ? b[i] : 0;
      if (left !== right) {
        return left - right;
      }
      if (left === 0) {
        return 0;
      }
    }
    return 0;
  };

  define('strlen', (s: unknown) =>
    cInt(memory.string(s, 'strlen', 'its argument').bytes.length)
  );

  define('strcpy', (to: unknown, from: unknown) => {
    const source = memory.string(from, 'strcpy', 'the source string');
    const target = destination(to, 'strcpy');
    const length = source.bytes.length + 1;
    memory.region(target, length, 'strcpy', 'the destination', true);
    if (overlapping(source.address, length, target, length)) {
      refuseOverlap('strcpy');
    }
    memory.writeBytes(target, source.bytes.concat([0]), 'strcpy');
    return target;
  });

  define('strncpy', (to: unknown, from: unknown, n: unknown) => {
    const count = sizeArg(n);
    const source = memory.string(from, 'strncpy', 'the source string', count);
    const target = destination(to, 'strncpy');
    memory.region(target, count, 'strncpy', 'the destination', true);
    const read = Math.min(source.bytes.length + 1, count);
    if (overlapping(source.address, read, target, count)) {
      refuseOverlap('strncpy');
    }
    const bytes = source.bytes.slice(0, count);
    while (bytes.length < count) {
      bytes.push(0);
    }
    memory.writeBytes(target, bytes, 'strncpy');
    if (0 < count && count <= source.bytes.length) {
      host.warn(
        'unterminated-string',
        `strncpy copied ${count} characters and no null character, so the ` +
          `destination does not hold a string until one is stored after them`
      );
    }
    return target;
  });

  const append = (fn: string, to: unknown, source: StringArg): number => {
    const target = destination(to, fn);
    const existing = memory.string(target, fn, 'the destination string');
    const at = target + existing.bytes.length;
    const length = source.bytes.length + 1;
    memory.region(at, length, fn, 'the destination', true);
    if (
      overlapping(
        source.address,
        length,
        target,
        existing.bytes.length + length
      )
    ) {
      refuseOverlap(fn);
    }
    memory.writeBytes(at, source.bytes.concat([0]), fn);
    return target;
  };

  define('strcat', (to: unknown, from: unknown) =>
    append('strcat', to, memory.string(from, 'strcat', 'the source string'))
  );

  define('strncat', (to: unknown, from: unknown, n: unknown) =>
    append(
      'strncat',
      to,
      memory.string(from, 'strncat', 'the source string', sizeArg(n))
    )
  );

  define('strcmp', (a: unknown, b: unknown) => {
    const left = memory.string(a, 'strcmp', 'the first string').bytes;
    const right = memory.string(b, 'strcmp', 'the second string').bytes;
    return cInt(compare(left, right, Math.max(left.length, right.length) + 1));
  });

  define('strncmp', (a: unknown, b: unknown, n: unknown) => {
    const count = sizeArg(n);
    const left = memory.string(a, 'strncmp', 'the first string', count).bytes;
    const right = memory.string(b, 'strncmp', 'the second string', count).bytes;
    return cInt(compare(left, right, count));
  });

  define('strchr', (s: unknown, c: unknown) => {
    const text = memory.string(s, 'strchr', 'the string');
    const wanted = num(c) & 0xff;
    const index = wanted === 0 ? text.bytes.length : text.bytes.indexOf(wanted);
    return index === -1 ? 0 : memory.pointerInto(text, index);
  });

  define('strrchr', (s: unknown, c: unknown) => {
    const text = memory.string(s, 'strrchr', 'the string');
    const wanted = num(c) & 0xff;
    const index =
      wanted === 0 ? text.bytes.length : text.bytes.lastIndexOf(wanted);
    return index === -1 ? 0 : memory.pointerInto(text, index);
  });

  define('strstr', (haystack: unknown, needle: unknown) => {
    const text = memory.string(haystack, 'strstr', 'the string searched');
    const wanted = memory.string(needle, 'strstr', 'the string sought').bytes;
    for (let at = 0; at + wanted.length <= text.bytes.length; at += 1) {
      if (wanted.every((byte, i) => text.bytes[at + i] === byte)) {
        return memory.pointerInto(text, at);
      }
    }
    return 0;
  });

  const prefix = (fn: string, s: unknown, set: unknown, inSet: boolean) => {
    const text = memory.string(s, fn, 'the string');
    const members = new Set(
      memory.string(set, fn, 'the set of characters').bytes
    );
    let length = 0;
    while (
      length < text.bytes.length &&
      members.has(text.bytes[length]) === inSet
    ) {
      length += 1;
    }
    return { text, length };
  };

  define('strspn', (s: unknown, accept: unknown) =>
    cInt(prefix('strspn', s, accept, true).length)
  );

  define('strcspn', (s: unknown, reject: unknown) =>
    cInt(prefix('strcspn', s, reject, false).length)
  );

  define('strpbrk', (s: unknown, accept: unknown) => {
    const { text, length } = prefix('strpbrk', s, accept, false);
    return length === text.bytes.length ? 0 : memory.pointerInto(text, length);
  });

  // Where the next `strtok(NULL, ...)` resumes. One per program run: the
  // engine installs a fresh library every time a program starts.
  let resume: number | null = null;
  let started = false;
  define('strtok', (s: unknown, delimiters: unknown) => {
    const delims = new Set(
      memory.string(delimiters, 'strtok', 'the delimiter string').bytes
    );
    let start: number;
    if (memory.isNull(s)) {
      if (!started) {
        host.refuse(
          'null-pointer-argument',
          'strtok was first called with a null pointer; the first call has ' +
            'to pass the string to split, and only later calls pass NULL'
        );
      }
      if (resume === null) {
        return 0;
      }
      start = resume;
    } else {
      if (Array.isArray(s) || typeof s === 'string') {
        host.refuse(
          'string-literal-modification',
          'strtok writes null characters into the string it splits, and a ' +
            'string literal cannot be modified; copy it into a char array first'
        );
      }
      start = memory.pointer(s, 'strtok', 'the string to split');
      started = true;
    }
    const text = memory.string(start, 'strtok', 'the string to split').bytes;
    let from = 0;
    while (from < text.length && delims.has(text[from])) {
      from += 1;
    }
    if (from === text.length) {
      resume = null;
      return 0;
    }
    let to = from;
    while (to < text.length && !delims.has(text[to])) {
      to += 1;
    }
    if (to < text.length) {
      memory.writeBytes(start + to, [0], 'strtok');
      resume = start + to + 1;
    } else {
      resume = start + to;
    }
    return start + from;
  });

  /**
   * The structures a `mem*` call covers when its pointer is one, or null
   * when it is not. A structure is a descriptor word and its members here,
   * so the bytes between two pointers say nothing about the members; a call
   * covering whole structures is carried out member by member instead.
   */
  const recordSpan = (
    address: number | null,
    n: number,
    fn: string,
    what: string
  ): { type: string; descriptors: number[] } | null => {
    const type = address === null ? null : memory.recordAt(address);
    if (address === null || type === null) {
      return null;
    }
    const size = host.recordSize(type);
    if (n === 0 || size <= 0 || n % size !== 0) {
      host.refuse(
        'partial-record',
        `${fn} covers ${n} bytes of ${what}, a struct ${type} of ${size} ` +
          `bytes; c-visualizer applies ${fn} to whole structures only`
      );
    }
    const stride = host.recordStride(type);
    const descriptors: number[] = [];
    for (let k = 0; k < n / size; k += 1) {
      const descriptor = address + k * stride;
      if (memory.recordAt(descriptor) !== type) {
        host.refuse(
          'buffer-overflow',
          `${fn} would cover ${n / size} structures from ${what}, but only ` +
            `${k} ${k === 1 ? 'is' : 'are'} there`
        );
      }
      descriptors.push(descriptor);
    }
    return { type, descriptors };
  };

  const cellsOf = (span: { type: string; descriptors: number[] }) =>
    span.descriptors.flatMap((descriptor) =>
      host.recordCells(span.type, descriptor)
    );

  const pointerOrNull = (value: unknown): number | null =>
    Array.isArray(value) || typeof value === 'string' ? null : num(value);

  const copy = (fn: string, to: unknown, from: unknown, n: unknown) => {
    const count = sizeArg(n);
    const target = destination(to, fn);
    if (count === 0) {
      return target;
    }
    const source = pointerOrNull(from);
    const targetSpan = recordSpan(target, count, fn, 'the destination');
    const sourceSpan =
      source === null || source === 0
        ? null
        : recordSpan(source, count, fn, 'the source');
    if (targetSpan !== null || sourceSpan !== null) {
      if (
        targetSpan === null ||
        sourceSpan === null ||
        targetSpan.type !== sourceSpan.type
      ) {
        host.refuse(
          'record-copy',
          `${fn} copies between a structure and something that is not a ` +
            `structure of the same type; c-visualizer copies a structure ` +
            `only into a structure of the same type`
        );
      }
      // A structure's engine extent is its descriptor and members, which is
      // not the `sizeof` the program passed.
      const extent =
        sourceSpan.descriptors.length * host.recordStride(sourceSpan.type);
      if (fn === 'memcpy' && overlapping(source, extent, target, extent)) {
        refuseOverlap(fn);
      }
      const values = cellsOf(sourceSpan).map((cell) =>
        global.objectOnMemory.get(cell.address)
      );
      cellsOf(targetSpan).forEach((cell, i) =>
        host.write(cell.address, values[i], fn)
      );
      return target;
    }
    const bytes = memory.bytes(from, count, fn, 'the source');
    memory.region(target, count, fn, 'the destination', true);
    if (fn === 'memcpy' && overlapping(bytes.address, count, target, count)) {
      refuseOverlap(fn);
    }
    if (bytes.bytes.some((byte) => byte === null)) {
      host.warn(
        'uninitialized-read',
        `${fn} copies bytes nothing has been stored in yet; the copy is ` +
          `just as indeterminate`
      );
    }
    memory.writeBytes(target, bytes.bytes, fn);
    return target;
  };

  define('memcpy', (to: unknown, from: unknown, n: unknown) =>
    copy('memcpy', to, from, n)
  );

  define('memmove', (to: unknown, from: unknown, n: unknown) =>
    copy('memmove', to, from, n)
  );

  define('memset', (s: unknown, c: unknown, n: unknown) => {
    const count = sizeArg(n);
    const target = destination(s, 'memset');
    if (count === 0) {
      return target;
    }
    const byte = num(c) & 0xff;
    const span = recordSpan(target, count, 'memset', 'the destination');
    if (span !== null) {
      for (const cell of cellsOf(span)) {
        const size = Engine.sizeof(cell.type);
        host.write(
          cell.address,
          decodeValue(new Array(size).fill(byte), cell.type),
          'memset'
        );
      }
      return target;
    }
    memory.region(target, count, 'memset', 'the destination', true);
    memory.writeBytes(target, new Array(count).fill(byte), 'memset');
    return target;
  });

  /** The bytes a record span holds, member after member. */
  const recordBytes = (span: { type: string; descriptors: number[] }) =>
    cellsOf(span).flatMap((cell) =>
      encodeValue(
        global.objectOnMemory.get(cell.address),
        cell.type,
        Engine.sizeof(cell.type)
      )
    );

  define('memcmp', (a: unknown, b: unknown, n: unknown) => {
    const count = sizeArg(n);
    if (count === 0) {
      return cInt(0);
    }
    const read = (value: unknown, what: string): (number | null)[] => {
      const address = pointerOrNull(value);
      const span =
        address === null || address === 0
          ? null
          : recordSpan(address, count, 'memcmp', what);
      return span === null
        ? memory.bytes(value, count, 'memcmp', what).bytes
        : recordBytes(span);
    };
    const left = read(a, 'the first block');
    const right = read(b, 'the second block');
    for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
      if (left[i] === null || right[i] === null) {
        host.refuse(
          'uninitialized-read',
          `memcmp compares byte ${i}, which nothing has been stored in yet`
        );
      }
      if (left[i] !== right[i]) {
        return cInt((left[i] as number) - (right[i] as number));
      }
    }
    return cInt(0);
  });

  define('memchr', (s: unknown, c: unknown, n: unknown) => {
    const count = sizeArg(n);
    const wanted = num(c) & 0xff;
    const block = memory.bytes(s, count, 'memchr', 'the block');
    const index = block.bytes.indexOf(wanted);
    if (index === -1) {
      return 0;
    }
    return (
      (block.address === null
        ? addressOf(s, 'memchr', 'the block')
        : block.address) + index
    );
  });

  define('strerror', (errnum: unknown) =>
    host.literalAddress(
      toBytes(strerrorText(Math.trunc(num(errnum)))).concat([0])
    )
  );
}
