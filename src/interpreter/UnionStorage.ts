import { Engine } from 'unicoen.ts/dist/interpreter/Engine/Engine';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { decodeValue, encodeValue, num } from './library/memory';
import { DisplayField, Member, RecordTable } from './RecordTable';

/**
 * The bytes a union's members share.
 *
 * The engine keeps memory as typed cells, one per scalar, and gives each
 * member of a union storage of its own (`UnionTable`). What C says is that
 * they are one block of `sizeof` bytes seen through different types, so a
 * store into one member changes what every other member reads. This keeps
 * the cells saying that: after a store lands inside a union, the member it
 * landed in is encoded into the bytes C would hold - little-endian, at the
 * offsets of C's own layout, padding and bit-fields included - and every
 * other member is decoded from those bytes into its cells. Reads then need
 * nothing special: each member's cells always hold what that member reads,
 * and the canvas draws them as they are.
 *
 * Bytes no member has a value for yet are `null`, and a scalar any of whose
 * bytes is `null` is left uninitialized: half of an indeterminate `int` is
 * still indeterminate.
 */

/** The bytes of an object, least significant first; `null` for unknown. */
type Bytes = (number | null)[];

/** The two maps the engine's memory is. */
export interface Cells {
  objectOnMemory: Map<number, unknown>;
  typeOnMemory: Map<number, string>;
}

/** What the engine knows that this needs. */
export interface UnionStorageHost {
  /** The table that declares a record type, or null for any other type. */
  tableFor(type: string): RecordTable | null;
  /** A scalar type as C stores it: its size, and how its bytes are read. */
  scalarOf(type: string): { size: number; floating: boolean; signed: boolean };
  /** A value converted to the type of the cell it is stored in. */
  convert(cellType: string, value: number): unknown;
  /** A cell has been given a value, so it no longer counts as unwritten. */
  wrote(address: number): void;
}

/** One union laid out in memory, filed under where its members begin. */
interface LiveUnion {
  /** As its descriptor word is typed: the name, without `union`. */
  type: string;
  /**
   * The scope whose lifetime the union has, or null for one that lives as
   * long as its descriptor does (on the heap, or at file scope).
   */
  owner: Scope | null;
}

const withoutTag = (type: string): string =>
  type.replace(/^\s*(struct|union)\s+/, '').trim();

/** Lays `from` over `onto` from `at` on; an unknown byte leaves what is there. */
const overlay = (onto: Bytes, from: Bytes, at: number): void => {
  from.forEach((byte, index) => {
    if (byte !== null && at + index < onto.length) {
      onto[at + index] = byte;
    }
  });
};

const product = (lengths: number[]): number =>
  lengths.reduce((total, length) => total * length, 1);

export class UnionStorage {
  private readonly unions = new Map<number, LiveUnion>();

  constructor(private readonly host: UnionStorageHost) {}

  /** Forgets every union, for a new run. */
  clear(): void {
    this.unions.clear();
  }

  /**
   * Files a union whose members begin at `base`, so that a store inside it
   * is shared with its other members. Laying one out again at the same place
   * replaces the earlier one.
   */
  register(base: number, type: string, owner: Scope | null): void {
    const parent = owner === null ? null : owner.parent;
    this.unions.set(base, {
      type: withoutTag(type),
      owner: parent === null || typeof parent === 'undefined' ? null : owner,
    });
  }

  /**
   * After a store at `address`: every union the address is inside, innermost
   * first, has its other members decoded from the member that holds it. A
   * union that is the member of another changes that one's bytes too, which
   * is why the outer ones follow.
   */
  stored(address: number, cells: Cells): void {
    if (this.unions.size === 0) {
      return;
    }
    const containing: { base: number; type: string; extent: number }[] = [];
    for (const [base, entry] of this.unions) {
      if (address < base) {
        continue;
      }
      const table = this.host.tableFor(entry.type);
      if (table === null) {
        this.unions.delete(base);
        continue;
      }
      const extent = table.sizeOf(entry.type);
      if (base + extent <= address) {
        continue;
      }
      if (!this.isLive(base, entry, cells)) {
        this.unions.delete(base);
        continue;
      }
      containing.push({ base, type: entry.type, extent });
    }
    containing.sort((left, right) => left.extent - right.extent);
    for (const { base, type } of containing) {
      this.share(type, base, address, cells);
    }
  }

  /**
   * Gives the members of a union just laid out at `base` the bytes it starts
   * with: those of `initialized`, the member an initializer named, over
   * `fill` - zero for an initialized or static union, unknown for one left
   * uninitialized, or random bits. `initialized` already holds its value.
   */
  initialize(
    type: string,
    base: number,
    initialized: Member | null,
    fill: 'zero' | 'unknown' | 'random',
    cells: Cells
  ): void {
    const table = this.host.tableFor(type);
    const members = table?.membersOf(type) ?? null;
    if (table === null || members === null) {
      return;
    }
    const bytes: Bytes = Array.from(
      { length: table.displaySizeOf(type) },
      () =>
        fill === 'zero'
          ? 0
          : fill === 'unknown'
            ? null
            : Math.floor(Math.random() * 256)
    );
    if (initialized !== null) {
      this.encodeMembers(type, base, [initialized], bytes, cells);
    }
    this.decodeMembers(
      type,
      base,
      members.filter((member) => member !== initialized),
      bytes,
      cells
    );
  }

  /** The other members of the union at `base`, from the one `address` is in. */
  private share(type: string, base: number, address: number, cells: Cells) {
    const table = this.host.tableFor(type);
    const layout = table?.layoutOf(type) ?? null;
    const members = table?.membersOf(type) ?? null;
    if (table === null || layout === null || members === null) {
      return;
    }
    const written = members.find((member) => {
      const field = layout.get(member.name);
      return (
        typeof field !== 'undefined' &&
        base + field[0] <= address &&
        address < base + field[0] + field[2]
      );
    });
    if (typeof written === 'undefined') {
      return;
    }
    const others = members.filter((member) => member !== written);
    const bytes: Bytes = new Array(table.displaySizeOf(type)).fill(null);
    // The other members agree with one another, so the order they are laid
    // down in does not matter; the one just written goes over all of them.
    this.encodeMembers(type, base, others, bytes, cells);
    this.encodeMembers(type, base, [written], bytes, cells);
    this.decodeMembers(type, base, others, bytes, cells);
  }

  /** Whether the union filed at `base` is still the object there. */
  private isLive(base: number, entry: LiveUnion, cells: Cells): boolean {
    const descriptor = base - Engine.structInfoSize;
    if (
      cells.typeOnMemory.get(descriptor) !== entry.type ||
      num(cells.objectOnMemory.get(descriptor)) !== base
    ) {
      return false;
    }
    // A block or a function that has returned leaves its cells behind, and
    // the next frame reuses the addresses without necessarily overwriting
    // the descriptor; its scope is what says the union is gone.
    for (
      let scope: Scope | null = entry.owner;
      scope !== null && scope.parent !== null && scope.parent !== undefined;
      scope = scope.parent
    ) {
      if (scope.parent.children.indexOf(scope) === -1) {
        return false;
      }
    }
    return true;
  }

  /** Lays the bytes of some members of a record over `bytes`. */
  private encodeMembers(
    type: string,
    base: number,
    members: Member[],
    bytes: Bytes,
    cells: Cells
  ): void {
    const table = this.host.tableFor(type)!;
    const layout = table.layoutOf(type)!;
    const fields = table.displayFieldsOf(type)!;
    for (const member of members) {
      const engine = layout.get(member.name);
      const field = fields.get(member.name);
      if (typeof engine === 'undefined' || typeof field === 'undefined') {
        continue;
      }
      const address = base + engine[0];
      if (typeof member.bits === 'number') {
        this.encodeBits(
          bytes,
          field,
          member.bits,
          cells.objectOnMemory.get(address)
        );
      } else {
        overlay(bytes, this.encodeMember(member, address, cells), field.offset);
      }
    }
  }

  /** Gives some members of a record the values `bytes` holds for them. */
  private decodeMembers(
    type: string,
    base: number,
    members: Member[],
    bytes: Bytes,
    cells: Cells
  ): void {
    const table = this.host.tableFor(type)!;
    const layout = table.layoutOf(type)!;
    const fields = table.displayFieldsOf(type)!;
    for (const member of members) {
      const engine = layout.get(member.name);
      const field = fields.get(member.name);
      if (typeof engine === 'undefined' || typeof field === 'undefined') {
        continue;
      }
      const address = base + engine[0];
      if (typeof member.bits === 'number') {
        const value = this.decodeBits(bytes, field, member.bits);
        this.store(address, value === null ? null : Number(value), cells);
      } else {
        this.decodeMember(
          member,
          address,
          bytes.slice(field.offset, field.offset + field.size),
          cells
        );
      }
    }
  }

  /** The bytes of one member, whose engine storage starts at `address`. */
  private encodeMember(member: Member, address: number, cells: Cells): Bytes {
    const element = this.elementOf(member);
    if (member.lengths.length === 0) {
      return this.encodeObject(element, address, cells);
    }
    const count = product(member.lengths);
    const bytes: Bytes = new Array(count * element.size).fill(null);
    for (let index = 0; index < count; index += 1) {
      overlay(
        bytes,
        this.encodeObject(element, address + index * element.stride, cells),
        index * element.size
      );
    }
    return bytes;
  }

  private decodeMember(
    member: Member,
    address: number,
    bytes: Bytes,
    cells: Cells
  ): void {
    const element = this.elementOf(member);
    const count = member.lengths.length === 0 ? 1 : product(member.lengths);
    for (let index = 0; index < count; index += 1) {
      this.decodeObject(
        element,
        address + index * element.stride,
        bytes.slice(index * element.size, (index + 1) * element.size),
        cells
      );
    }
  }

  /**
   * What one object of a member's type is: a record, by its descriptor, or a
   * scalar, by its cell; how many bytes C gives it; and how far apart the
   * engine puts two of them in an array.
   */
  private elementOf(member: Member): {
    type: string;
    record: boolean;
    size: number;
    stride: number;
  } {
    const table =
      member.type.indexOf('*') === -1 ? this.host.tableFor(member.type) : null;
    if (table !== null) {
      return {
        type: withoutTag(member.type),
        record: true,
        size: table.displaySizeOf(member.type),
        stride: Engine.structInfoSize + table.sizeOf(member.type),
      };
    }
    return {
      type: member.type,
      record: false,
      size: this.host.scalarOf(member.type).size,
      stride: Engine.sizeof(member.type),
    };
  }

  private encodeObject(
    element: { type: string; record: boolean; size: number },
    address: number,
    cells: Cells
  ): Bytes {
    if (!element.record) {
      const scalar = this.host.scalarOf(element.type);
      // `encodeValue` reads the floating types off the type's spelling;
      // typedefs are already resolved here, so a neutral one says which.
      return encodeValue(
        cells.objectOnMemory.get(address),
        scalar.floating ? 'double' : 'long',
        scalar.size
      );
    }
    const table = this.host.tableFor(element.type)!;
    const members = table.membersOf(element.type)!;
    const bytes: Bytes = new Array(element.size).fill(null);
    this.encodeMembers(
      element.type,
      address + Engine.structInfoSize,
      members,
      bytes,
      cells
    );
    return bytes;
  }

  private decodeObject(
    element: { type: string; record: boolean },
    address: number,
    bytes: Bytes,
    cells: Cells
  ): void {
    if (element.record) {
      const table = this.host.tableFor(element.type)!;
      this.decodeMembers(
        element.type,
        address + Engine.structInfoSize,
        table.membersOf(element.type)!,
        bytes,
        cells
      );
      return;
    }
    if (bytes.some((byte) => byte === null)) {
      this.store(address, null, cells);
      return;
    }
    const scalar = this.host.scalarOf(element.type);
    if (scalar.floating) {
      this.store(address, num(decodeValue(bytes, 'double')), cells);
      return;
    }
    let whole = BigInt(0);
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
      whole = (whole << BigInt(8)) | BigInt(bytes[index] as number);
    }
    const bits = bytes.length * 8;
    this.store(
      address,
      Number(
        scalar.signed ? BigInt.asIntN(bits, whole) : BigInt.asUintN(bits, whole)
      ),
      cells
    );
  }

  /** A bit-field's value into its storage unit, its other bits kept. */
  private encodeBits(
    bytes: Bytes,
    field: DisplayField,
    bits: number,
    value: unknown
  ): void {
    const raw = num(value);
    if (!Number.isFinite(raw)) {
      return;
    }
    const shift = BigInt(field.bitOffset ?? 0);
    const mask = ((BigInt(1) << BigInt(bits)) - BigInt(1)) << shift;
    let unit = BigInt(0);
    for (let index = 0; index < field.size; index += 1) {
      unit |= BigInt(bytes[field.offset + index] ?? 0) << BigInt(8 * index);
    }
    unit =
      (unit & ~mask) | (BigInt.asUintN(bits, BigInt(Math.trunc(raw))) << shift);
    for (let index = 0; index < field.size; index += 1) {
      bytes[field.offset + index] = Number(
        (unit >> BigInt(8 * index)) & BigInt(0xff)
      );
    }
  }

  /** A bit-field's bits, unsigned; the store converts them to its type. */
  private decodeBits(
    bytes: Bytes,
    field: DisplayField,
    bits: number
  ): bigint | null {
    let unit = BigInt(0);
    for (let index = 0; index < field.size; index += 1) {
      const byte = bytes[field.offset + index];
      if (byte === null || typeof byte === 'undefined') {
        return null;
      }
      unit |= BigInt(byte) << BigInt(8 * index);
    }
    return BigInt.asUintN(bits, unit >> BigInt(field.bitOffset ?? 0));
  }

  /** A decoded value into its cell, converted to the cell's type. */
  private store(address: number, value: number | null, cells: Cells): void {
    if (!cells.objectOnMemory.has(address)) {
      return;
    }
    if (value === null) {
      cells.objectOnMemory.set(address, null);
      return;
    }
    const cellType = cells.typeOnMemory.get(address) ?? '';
    cells.objectOnMemory.set(address, this.host.convert(cellType, value));
    this.host.wrote(address);
  }
}
