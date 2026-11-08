import { Engine } from 'unicoen.ts/dist/interpreter/Engine/Engine';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { LibraryHost } from './host';
import { Memory, num, sizeArg } from './memory';

/**
 * `realloc`, with the move a reader can watch.
 *
 * The engine's heap is a cursor that only moves forward, and every block is
 * a run of typed cells behind it. So a block can only grow where it stands
 * when it is the last one carved; any other block grows by moving: a new
 * block is carved where `malloc` would put it, the old cells are copied into
 * it with ordinary writes, and the old block is freed - the canvas shows the
 * old rows gone and the pointer's arrow on the new block, and the mutation
 * view says "moved from A to B". A shrink keeps the block where it is and
 * frees its tail. `realloc(NULL, n)` is `malloc(n)`; `realloc(p, 0)` frees
 * the block and returns a null pointer, as glibc does, with a note that C23
 * makes that call undefined.
 *
 * A pointer that `malloc`, `calloc` or `realloc` did not return, one into
 * the middle of a block, and one to a block already freed are refused rather
 * than resized.
 */

const hex = (address: number): string =>
  `0x${address.toString(16).toUpperCase()}`;

const bytes = (count: number): string =>
  `${count} byte${count === 1 ? '' : 's'}`;

/** `malloc` refuses an element count this large (upstream's limit). */
const MALLOC_LIMIT = 10000000;

export function installRealloc(global: Scope, host: LibraryHost): void {
  const memory = new Memory(host);
  const allocate = global.get('malloc');
  const heap = global.mallocData;

  /** Where the cells of the block at `start` end: at the next block, or the cursor. */
  const limitOf = (start: number): number => {
    let limit = global.address.heapAddress;
    for (const other of heap.keys()) {
      if (start < other && other < limit) {
        limit = other;
      }
    }
    return limit;
  };

  const isLast = (start: number): boolean =>
    Array.from(heap.keys()).every((other) => other <= start);

  /** Carves a block of `size` bytes of cells of `type`, as `malloc` would. */
  const carve = (self: unknown, size: number, type: string): number => {
    if (typeof allocate !== 'function') {
      return 0;
    }
    // `malloc` reads the pointee from the type `sizeof` or the declaration
    // last named, and takes one star off it.
    const named = Engine.lastSizeOf;
    Engine.lastSizeOf = `${type}*`;
    try {
      const block = allocate.call(self, size);
      return typeof block === 'number' ? block : 0;
    } finally {
      Engine.lastSizeOf = named;
    }
  };

  global.setTop(
    'realloc',
    function (this: unknown, pointer: unknown, rawSize: unknown) {
      const size = sizeArg(rawSize);
      if (memory.isNull(pointer)) {
        return typeof allocate === 'function' ? allocate.call(this, size) : 0;
      }
      const start = memory.pointer(pointer, 'realloc', 'the pointer');
      const recorded = heap.get(start);
      if (typeof recorded === 'undefined') {
        const inside = memory.objectAt(start);
        host.refuse(
          'invalid-realloc',
          inside !== null && (inside.kind === 'heap' || inside.kind === 'freed')
            ? `realloc was given a pointer into the middle of ${inside.name}; ` +
                `it takes the pointer malloc, calloc or realloc returned, which ` +
                `points at the start of the block`
            : `realloc was given a pointer to ${
                inside === null ? 'memory' : inside.name
              } that malloc, calloc or realloc did not return; it can only ` +
                `resize an allocated block`
        );
      }
      if (!global.objectOnMemory.has(start)) {
        host.refuse(
          'use-after-free',
          `realloc was given a pointer to the block at ${hex(start)}, which ` +
            `has already been freed`
        );
      }
      const type = global.typeOnMemory.get(start) ?? 'char';
      const record =
        type.indexOf('*') === -1 &&
        host.isRecordType(type) &&
        num(global.objectOnMemory.get(start)) === start + Engine.structInfoSize;
      // A record block's size counts its descriptor word, which C does not see.
      const overhead = record ? Engine.structInfoSize : 0;
      const old = recorded - overhead;
      const limit = limitOf(start);
      const call = host.currentCall();
      const argument =
        call === null || call.args.length === 0
          ? ''
          : host.sourceText(call.args[0]);
      const target = `*${argument === '' ? hex(start) : argument}`;
      const before = `${hex(start)}, ${bytes(old)}`;

      if (size === 0) {
        global.removeOnMemory(start, limit - start);
        host.warn(
          'realloc-zero-size',
          'realloc with size 0 freed the block and returned a null pointer, ' +
            'as glibc does; C23 makes this call undefined, so call free instead'
        );
        host.note(target, before, 'freed; realloc returned NULL');
        return 0;
      }
      if (size === old) {
        return start;
      }

      if (record) {
        // A block of records holds as many as its size has room for, one
        // after another; each is copied member by member.
        const records = host.recordBlock(type, start);
        if (size < old && records.length <= 1) {
          const base = start + Engine.structInfoSize;
          for (const cell of host.recordCells(type, start)) {
            if (cell.address - base >= size) {
              global.removeOnMemory(cell.address, Engine.sizeof(cell.type));
            }
          }
        }
        if (size < old || isLast(start)) {
          heap.set(start, size + overhead);
          host.recordBlock(type, start);
          host.note(
            target,
            before,
            `${hex(start)}, ${bytes(size)} (${
              size < old ? 'tail freed' : 'grown in place'
            })`
          );
          return start;
        }
        const fresh = carve(this, size, type);
        if (fresh === 0) {
          return 0;
        }
        heap.set(fresh, size + overhead);
        const moved = host.recordBlock(type, fresh);
        records.forEach((descriptor, n) => {
          if (moved.length <= n) {
            return;
          }
          const to = host.recordCells(type, moved[n]);
          host.recordCells(type, descriptor).forEach((cell, i) => {
            const value = global.objectOnMemory.get(cell.address);
            if (
              i < to.length &&
              value !== null &&
              typeof value !== 'undefined' &&
              !host.isUnwritten(cell.address)
            ) {
              host.write(to[i].address, value, 'realloc');
            }
          });
        });
        global.removeOnMemory(start, limit - start);
        host.note(
          target,
          before,
          `moved from ${hex(start)} to ${hex(fresh)}, ${bytes(size)}`
        );
        return fresh;
      }

      const width = Engine.sizeof(type);
      const count = Math.ceil(size / width);
      if (MALLOC_LIMIT <= count) {
        // Like malloc, a request this size fails, and the block is untouched.
        return 0;
      }
      const end = start + count * width;
      if (size < old) {
        global.removeOnMemory(end, limit - end);
        if (isLast(start)) {
          // The tail is free again: the next block is carved where it was.
          global.address.heapAddress = end;
        }
        heap.set(start, size);
        host.note(target, before, `${hex(start)}, ${bytes(size)} (tail freed)`);
        return start;
      }
      if (isLast(start)) {
        // Fresh cells hold nothing yet, as `malloc`'s do.
        while (global.address.heapAddress < end) {
          global.setHeap(null, type);
        }
        heap.set(start, size);
        host.note(
          target,
          before,
          `${hex(start)}, ${bytes(size)} (grown in place)`
        );
        return start;
      }
      const fresh = carve(this, size, type);
      if (fresh === 0) {
        return 0;
      }
      heap.set(fresh, size);
      for (let offset = 0; offset < limit - start; offset += 1) {
        const from = start + offset;
        const value = global.objectOnMemory.get(from);
        if (
          !global.objectOnMemory.has(from) ||
          !global.objectOnMemory.has(fresh + offset) ||
          value === null ||
          typeof value === 'undefined' ||
          host.isUnwritten(from)
        ) {
          continue;
        }
        host.write(fresh + offset, value, 'realloc');
      }
      global.removeOnMemory(start, limit - start);
      host.note(
        target,
        before,
        `moved from ${hex(start)} to ${hex(fresh)}, ${bytes(size)}`
      );
      return fresh;
    },
    'FUNCTION'
  );
}
