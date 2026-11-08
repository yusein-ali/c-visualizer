import { Int } from 'unicoen.ts/dist/interpreter/CPP14/Int';
import { Engine } from 'unicoen.ts/dist/interpreter/Engine/Engine';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { LibraryHost } from './host';

/**
 * Memory as the library sees it: objects with bounds, bytes inside them.
 *
 * The engine does not store bytes. It keeps one entry per scalar object -
 * a `char` at one address, an `int` at the next multiple of four, a
 * `double` every eight - and a structure as a descriptor word followed by
 * its members. The `mem*` and `str*` families are defined on bytes, so this
 * module turns the two into each other: a cell is encoded into the bytes C
 * would store for it (little-endian, as on the machines a course runs on),
 * bytes are written into the cells they fall in, and a cell is decoded
 * again. `memset(a, 1, sizeof a)` on an `int` array therefore leaves
 * 16843009 in every element, which is the surprise C has in store.
 *
 * It also knows where each object begins and ends, which is what lets a
 * library function refuse to write past the end of an array instead of
 * quietly overwriting the variable next to it.
 */

/** The engine's segments (`Scope` starts its cursors at these). */
const STATIC_AREA_BASE = 10000;
const HEAP_BASE = 20000;
const STACK_BASE = 50000;

/** A value the engine produced, as a number. */
export const num = (value: unknown): number => {
  if (value === null || typeof value === 'undefined') {
    return NaN;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  const raw = (value as { valueOf(): unknown }).valueOf();
  return typeof raw === 'number' ? raw : Number(raw);
};

/**
 * An `int`-width result as the engine keeps one. A plain JavaScript number
 * would make `strlen(s) / 2` a fraction: the engine only divides as C does
 * when both operands are `Int`.
 */
export const cInt = (value: number): Int => new Int(value);

/**
 * A `long long` result: `Int` while it fits 32 bits, the plain number past
 * that, because `Int` would wrap it and this engine has no wider integer.
 */
export const cWide = (value: number): number | Int =>
  Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
    ? new Int(value)
    : value;

/** An `unsigned long` argument as C converts one: modulo 2^32 here. */
export const sizeArg = (value: unknown): number => {
  const n = Math.trunc(num(value));
  return Number.isFinite(n) ? n >>> 0 : 0;
};

const isFloating = (type: string): boolean =>
  type.indexOf('*') === -1 && /\b(float|double)\b/.test(type);

/** The bytes C stores for a value of a type, least significant first. */
export function encodeValue(
  value: unknown,
  type: string,
  size: number
): (number | null)[] {
  const n = num(value);
  if (
    value === null ||
    typeof value === 'undefined' ||
    (Number.isNaN(n) && !isFloating(type))
  ) {
    return new Array(size).fill(null);
  }
  const view = new DataView(new ArrayBuffer(8));
  if (isFloating(type)) {
    if (size === 8) {
      view.setFloat64(0, n, true);
    } else {
      view.setFloat32(0, n, true);
    }
  } else {
    const whole = Number.isFinite(n) ? Math.trunc(n) : 0;
    view.setBigUint64(0, BigInt.asUintN(64, BigInt(whole)), true);
  }
  return Array.from({ length: size }, (_, i) => view.getUint8(i));
}

/** The value a cell of a type holds when its bytes are these. */
export function decodeValue(bytes: (number | null)[], type: string): unknown {
  if (bytes.some((byte) => byte === null)) {
    return null;
  }
  const size = bytes.length;
  const view = new DataView(new ArrayBuffer(8));
  bytes.forEach((byte, i) => view.setUint8(i, byte as number));
  if (isFloating(type)) {
    return size === 8 ? view.getFloat64(0, true) : view.getFloat32(0, true);
  }
  const whole = view.getBigUint64(0, true);
  if (type.indexOf('*') !== -1 || size === 1) {
    // An address, or a char: the engine keeps both as plain numbers.
    return Number(whole);
  }
  return new Int(Number(BigInt.asIntN(size * 8, whole)));
}

/** One object: a variable, an allocated block, or a string literal. */
export interface MemoryObject {
  start: number;
  /** One past the last byte. */
  end: number;
  /** As a message names it: `buf`, `the allocated block`. */
  name: string;
  kind: 'object' | 'heap' | 'freed' | 'literal';
}

/** One stored scalar: where it starts, what it is, how wide it is. */
interface Cell {
  start: number;
  type: string;
  size: number;
  /** A structure's descriptor word, which is layout rather than data. */
  descriptor: boolean;
}

/** A `char *` argument, read. */
export interface StringArg {
  /** The characters, without the terminator. */
  bytes: number[];
  /** Where they are, or null for a literal the engine never wrote out. */
  address: number | null;
}

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

export class Memory {
  constructor(private readonly host: LibraryHost) {}

  private get scope(): Scope {
    return this.host.global;
  }

  /** A pointer argument as an address; a null pointer stops the program. */
  pointer(value: unknown, fn: string, what: string): number {
    const address = num(value);
    if (!Number.isFinite(address)) {
      this.host.refuse(
        'invalid-pointer',
        `${fn} was not given a pointer as ${what}`
      );
    }
    if (address === 0) {
      this.host.refuse(
        'null-pointer-argument',
        `${fn} was passed a null pointer as ${what}, which does not point to an object`
      );
    }
    return address;
  }

  /** Whether a pointer argument is null, without stopping for it. */
  isNull(value: unknown): boolean {
    return !Array.isArray(value) && num(value) === 0;
  }

  /** The cell an address falls in, or null for a hole between objects. */
  private cellAt(address: number): Cell | null {
    const memory = this.scope.objectOnMemory;
    const types = this.scope.typeOnMemory;
    for (let back = 0; back < 8; back += 1) {
      const start = address - back;
      const type = types.get(start);
      if (typeof type === 'undefined' || !memory.has(start)) {
        continue;
      }
      if (type === 'FUNCTION' || type === 'SYSTEM' || type === 'CLASS') {
        return null;
      }
      const record = type.indexOf('*') === -1 && this.host.isRecordType(type);
      const size = record ? Engine.structInfoSize : Engine.sizeof(type);
      if (size <= back) {
        return null;
      }
      return {
        start,
        type,
        size,
        descriptor:
          record && num(memory.get(start)) === start + Engine.structInfoSize,
      };
    }
    return null;
  }

  /**
   * The byte at an address: a number, null when the cell holds no value
   * yet (a fresh `malloc` block), or undefined for no cell at all.
   */
  private byteAt(address: number): number | null | undefined {
    const cell = this.cellAt(address);
    if (cell === null || cell.descriptor) {
      return undefined;
    }
    const value = this.scope.objectOnMemory.get(cell.start);
    return encodeValue(value, cell.type, cell.size)[address - cell.start];
  }

  /** The object an address points into, or null when it points nowhere. */
  objectAt(address: number): MemoryObject | null {
    if (HEAP_BASE <= address && address < STACK_BASE) {
      return this.heapObjectAt(address);
    }
    if (address < STATIC_AREA_BASE) {
      return this.literalAt(address);
    }
    return this.variableAt(address);
  }

  private heapObjectAt(address: number): MemoryObject | null {
    for (const [start, size] of this.scope.mallocData) {
      const end = Math.max(this.host.blockEnd(start, size), start + 1);
      if (address < start || end <= address) {
        continue;
      }
      const live = this.scope.objectOnMemory.has(start);
      return {
        start,
        end,
        name: live
          ? `the allocated block of ${plural(size, 'byte')}`
          : 'a block that has already been freed',
        kind: live ? 'heap' : 'freed',
      };
    }
    return null;
  }

  /** A string literal: a run of `char` cells in read-only memory. */
  private literalAt(address: number): MemoryObject | null {
    const types = this.scope.typeOnMemory;
    const memory = this.scope.objectOnMemory;
    if (types.get(address) !== 'char') {
      return null;
    }
    let start = address;
    while (
      types.get(start - 1) === 'char' &&
      num(memory.get(start - 1)) !== 0
    ) {
      start -= 1;
    }
    let end = address;
    while (types.get(end) === 'char' && num(memory.get(end)) !== 0) {
      end += 1;
    }
    return { start, end: end + 1, name: 'a string literal', kind: 'literal' };
  }

  private variableAt(address: number): MemoryObject | null {
    const visit = (scope: Scope): MemoryObject | null => {
      for (const [name, at] of scope.variableAddress) {
        const type = scope.variableTypes.get(name);
        if (
          typeof type === 'undefined' ||
          type === 'FUNCTION' ||
          type === 'CLASS' ||
          type === 'SYSTEM'
        ) {
          continue;
        }
        const extent = this.extentOf(at, type);
        if (extent !== null && extent[0] <= address && address < extent[1]) {
          return { start: extent[0], end: extent[1], name, kind: 'object' };
        }
      }
      for (const child of scope.children) {
        const found = visit(child);
        if (found !== null) {
          return found;
        }
      }
      return null;
    };
    return visit(this.scope);
  }

  /** Where a declared object's bytes begin and end. */
  private extentOf(address: number, type: string): [number, number] | null {
    const memory = this.scope.objectOnMemory;
    if (!memory.has(address)) {
      return null;
    }
    const base = type.replace(/\[[^\]]*\]/g, '').trim();
    const record = base.indexOf('*') === -1 && this.host.isRecordType(base);
    if (type.indexOf('[') !== -1) {
      const dims = this.scope.getArrayDims(type);
      if (dims.length === 0 || dims.some((dim) => !(dim > 0))) {
        // `char s[]` as a parameter: a pointer by another name.
        return [address, address + Engine.sizeof('*')];
      }
      let first = num(memory.get(address));
      for (let level = 1; level < dims.length; level += 1) {
        first = num(memory.get(first));
      }
      const count = dims.reduce((total, dim) => total * dim, 1);
      const stride = record
        ? this.host.recordStride(base)
        : Engine.sizeof(base);
      return Number.isFinite(first) ? [first, first + count * stride] : null;
    }
    if (record) {
      return [address, address + this.host.recordStride(base)];
    }
    return [address, address + Engine.sizeof(type)];
  }

  /**
   * The object an access starts in, checked: it exists, it is live, and the
   * `length` bytes from `address` all belong to it.
   */
  region(
    address: number,
    length: number,
    fn: string,
    what: string,
    writing: boolean
  ): MemoryObject {
    const object = this.objectAt(address);
    if (object === null) {
      this.host.refuse(
        'invalid-pointer',
        `${fn} was given a pointer as ${what} that does not point into any object`
      );
    }
    if (object.kind === 'freed') {
      this.host.refuse(
        'use-after-free',
        `${fn} uses ${what}, which points into ${object.name}`
      );
    }
    const room = object.end - address;
    if (room < length) {
      const offset = address - object.start;
      const from = offset === 0 ? '' : ` starting ${plural(offset, 'byte')} in`;
      this.host.refuse(
        writing ? 'buffer-overflow' : 'out-of-bounds-read',
        `${fn} would ${writing ? 'write' : 'read'} ${plural(length, 'byte')} ` +
          `of ${object.name}${from}, but only ${plural(room, 'byte')} of it ` +
          `${room === 1 ? 'is' : 'are'} there`
      );
    }
    return object;
  }

  /**
   * A `char *` argument as the characters it points at, up to the null
   * character. Reading past the end of the object without finding one stops
   * the program; so does a character nothing has been stored in.
   */
  string(
    value: unknown,
    fn: string,
    what: string,
    limit = Infinity
  ): StringArg {
    if (Array.isArray(value)) {
      const bytes: number[] = [];
      for (const byte of value) {
        if (bytes.length >= limit || num(byte) === 0) {
          break;
        }
        bytes.push(num(byte) & 0xff);
      }
      return { bytes, address: null };
    }
    if (typeof value === 'string') {
      return {
        bytes: Array.from(value.slice(0, Math.min(value.length, limit)), (c) =>
          c.charCodeAt(0)
        ),
        address: null,
      };
    }
    const address = this.pointer(value, fn, what);
    const object = this.region(address, 0, fn, what, false);
    const bytes: number[] = [];
    let warned = false;
    for (let at = address; bytes.length < limit; at += 1) {
      const byte = at < object.end ? this.byteAt(at) : undefined;
      if (typeof byte === 'undefined') {
        this.host.refuse(
          'unterminated-string',
          `${fn} reads ${what} past the end of ${object.name} without finding ` +
            `the null character that ends a string`
        );
      }
      if (byte === null) {
        this.host.refuse(
          'uninitialized-read',
          `${fn} reads ${what} from ${object.name}, but nothing has been ` +
            `stored in its byte ${at - object.start} yet`
        );
      }
      if (!warned && this.host.isUnwritten(this.cellAt(at)!.start)) {
        warned = true;
        this.host.warn(
          'uninitialized-read',
          `${fn} reads ${what} from ${object.name} before a value has been ` +
            `stored in every character it reads; those characters are ` +
            `indeterminate`
        );
      }
      if (byte === 0) {
        break;
      }
      bytes.push(byte);
    }
    return { bytes, address };
  }

  /**
   * `n` bytes of a `void *` argument. A literal reads as its own bytes,
   * terminator included, and no further.
   */
  bytes(
    value: unknown,
    n: number,
    fn: string,
    what: string
  ): { bytes: (number | null)[]; address: number | null } {
    if (Array.isArray(value) || typeof value === 'string') {
      const all = Array.isArray(value)
        ? value.map((byte) => num(byte) & 0xff)
        : Array.from(value + '\0', (c) => c.charCodeAt(0));
      if (all.length < n) {
        this.host.refuse(
          'out-of-bounds-read',
          `${fn} would read ${plural(n, 'byte')} of a string literal that ` +
            `holds only ${plural(all.length, 'byte')}`
        );
      }
      return { bytes: all.slice(0, n), address: null };
    }
    const address = this.pointer(value, fn, what);
    this.region(address, n, fn, what, false);
    const bytes: (number | null)[] = [];
    for (let at = address; at < address + n; at += 1) {
      const byte = this.byteAt(at);
      bytes.push(typeof byte === 'undefined' ? null : byte);
    }
    return { bytes, address };
  }

  /**
   * Stores bytes from an address on, cell by cell: each cell they touch is
   * re-encoded with its new bytes and written back through the engine, so
   * the canvas shows the value the cell now holds.
   */
  writeBytes(address: number, bytes: (number | null)[], fn: string): void {
    const memory = this.scope.objectOnMemory;
    const touched = new Map<number, { cell: Cell; bytes: (number | null)[] }>();
    for (let i = 0; i < bytes.length; i += 1) {
      const cell = this.cellAt(address + i);
      if (cell === null || cell.descriptor) {
        continue;
      }
      let entry = touched.get(cell.start);
      if (typeof entry === 'undefined') {
        // A byte the cell never held stays indeterminate unless this write
        // supplies it: half of an uninitialised `int` is still garbage.
        const held = encodeValue(memory.get(cell.start), cell.type, cell.size);
        entry = { cell, bytes: held };
        touched.set(cell.start, entry);
      }
      const byte = bytes[i];
      entry.bytes[address + i - cell.start] =
        byte === null ? null : byte & 0xff;
    }
    for (const { cell, bytes: cellBytes } of touched.values()) {
      this.host.write(cell.start, decodeValue(cellBytes, cell.type), fn);
    }
  }

  /**
   * The address of a character of a string argument, as a `char *`. A
   * literal the engine passed as bytes has no address until it is given one.
   */
  pointerInto(arg: StringArg, index: number): number {
    if (arg.address !== null) {
      return arg.address + index;
    }
    return this.host.literalAddress(arg.bytes.concat([0])) + index;
  }

  /** The record whose descriptor an address is, or null. */
  recordAt(address: number): string | null {
    const cell = this.cellAt(address);
    return cell !== null && cell.descriptor && cell.start === address
      ? cell.type
      : null;
  }
}
