/**
 * The bytes of a structure, as C lays them out, over the engine's cells.
 *
 * The engine keeps a structure as a descriptor word followed by its members,
 * packed at the engine's widths with no padding, and a nested structure as a
 * descriptor of its own. C has no descriptor: a structure's first byte is its
 * first member's, its members sit at aligned offsets, and the bytes between
 * them are padding. So an address from `(unsigned char *)&s` plus a count of
 * bytes named nothing the engine had - `fwrite(&s, sizeof s, 1, f)` wrote the
 * descriptor's four bytes first and lost the last member, and `p[1]` through
 * `const unsigned char *p = (const unsigned char *)&s` stopped the program.
 *
 * A shape says, for every byte offset of one structure in C's layout, which
 * byte of which engine cell holds it - or that it is padding - and the
 * reverse: which engine addresses inside the structure stand for which byte.
 * A byte of a scalar member is its cell's address plus the byte's index, as
 * a `char *` into an `int` already reads it; the start of a structure,
 * nested or not, is its descriptor, which is what a pointer to it holds.
 */

/** One byte of a structure that a member holds. */
export interface MemberByte {
  /** The member's cell, as an offset from the structure's descriptor. */
  cell: number;
  /** Which byte of the cell, least significant first. */
  byte: number;
  /** The cell's type, as the engine filed it. */
  type: string;
}

export interface RecordShape {
  /** `sizeof` the structure in C. */
  size: number;
  /** Engine addresses from one descriptor to the next in an array of them. */
  stride: number;
  /** For each byte offset in C, the member byte there, or null for padding. */
  bytes: (MemberByte | null)[];
  /**
   * For each byte offset in C, the engine address (as an offset from the
   * descriptor) a pointer to that byte holds, or null for a padding byte,
   * which the engine has no address for.
   */
  addresses: (number | null)[];
  /** The byte offset each engine address inside the structure stands for. */
  offsets: Map<number, number>;
  /**
   * For each byte offset in C, where the run of bytes it belongs to ends: a
   * member that is a scalar or an array of scalars is laid out the same in
   * both layouts, so bytes inside one can be stepped through at the
   * engine's addresses; a padding byte is a run of its own.
   */
  runEnds: number[];
}

/** One member of a structure, in both layouts. */
export interface ShapeMember {
  name: string;
  /** The type as written, without array lengths. */
  type: string;
  lengths: number[];
  /** Where C puts it, and how many bytes it takes, all elements together. */
  offset: number;
  size: number;
  /** Where the engine puts it, from the first member's cell. */
  engineOffset: number;
  bits?: number;
}

/** What a shape is built from: the engine's record tables. */
export interface ShapeSource {
  /**
   * The members of a structure type, or null for a type that is not one -
   * or not one this module lays out: a union, whose members share their
   * bytes in a store of their own (`UnionStorage`).
   */
  members(type: string): ShapeMember[] | null;
  /** `sizeof` a structure type in C. */
  size(type: string): number;
  /** The engine's width of a structure type, its descriptor not included. */
  engineSize(type: string): number;
  /** Bytes C gives one object of a scalar type. */
  scalarWidth(type: string): number;
  /** The engine's step from one element of an array of a scalar type to the next. */
  engineWidth(type: string): number;
  /** The engine's descriptor word, in front of every structure. */
  descriptorSize: number;
}

/**
 * The shape of a structure type, or null where a byte of it cannot be placed:
 * a union or a bit-field anywhere inside, or a member whose two layouts do
 * not agree on its width.
 */
export function shapeOf(type: string, source: ShapeSource): RecordShape | null {
  const size = source.size(type);
  if (source.members(type) === null || !(size > 0)) {
    return null;
  }
  const bytes: (MemberByte | null)[] = new Array(size).fill(null);
  const addresses: (number | null)[] = new Array(size).fill(null);
  const runEnds: number[] = Array.from({ length: size }, (_, at) => at + 1);
  const offsets = new Map<number, number>();
  const claim = (at: number, engine: number): void => {
    if (addresses[at] === null) {
      addresses[at] = engine;
    }
    if (!offsets.has(engine)) {
      offsets.set(engine, at);
    }
  };
  const walk = (
    record: string,
    descriptor: number,
    base: number,
    depth: number
  ): boolean => {
    const members = source.members(record);
    if (members === null || depth > 16) {
      return false;
    }
    claim(base, descriptor);
    const first = descriptor + source.descriptorSize;
    for (const member of members) {
      if (typeof member.bits === 'number') {
        return false;
      }
      const count = member.lengths.reduce((total, length) => total * length, 1);
      if (!(count > 0)) {
        return false;
      }
      const elementSize = member.size / count;
      const nested =
        member.type.indexOf('*') === -1 && source.members(member.type) !== null;
      const stride = nested
        ? source.descriptorSize + source.engineSize(member.type)
        : source.engineWidth(member.type);
      for (let index = 0; index < count; index += 1) {
        const engine = first + member.engineOffset + index * stride;
        const at = base + member.offset + index * elementSize;
        if (nested) {
          if (!walk(member.type, engine, at, depth + 1)) {
            return false;
          }
          continue;
        }
        const width = source.scalarWidth(member.type);
        if (width !== elementSize || width > stride) {
          return false;
        }
        for (let byte = 0; byte < width; byte += 1) {
          bytes[at + byte] = { cell: engine, byte, type: member.type };
          runEnds[at + byte] = base + member.offset + member.size;
          claim(at + byte, engine + byte);
        }
      }
    }
    return true;
  };
  if (!walk(type, 0, 0, 0)) {
    return null;
  }
  return {
    size,
    stride: source.descriptorSize + source.engineSize(type),
    bytes,
    addresses,
    offsets,
    runEnds,
  };
}
