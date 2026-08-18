import { RecordTable } from './RecordTable';

/**
 * `union` layout: every member starts at the same place, and the record is as
 * wide as its widest member.
 *
 * This is the whole difference from a struct, and it is the difference the
 * parse tree throws away - a union reaches the engine as the same
 * `UniClassDec` a struct does, gets sequential offsets, and quietly stops being
 * a union. Sharing the offset is what makes `u.i = 65; u.c` read 65.
 *
 * Members share an address, not bytes: reading a member returns whatever was
 * last written there, without being reinterpreted through the second member's
 * type. Writing an `int` and reading a `char` gives the whole value back rather
 * than its low byte.
 */
export class UnionTable extends RecordTable {
  protected readonly keyword = 'union';

  protected offsetsOf(sizes: number[]): number[] {
    return sizes.map(() => 0);
  }

  protected sizeOfAll(sizes: number[]): number {
    return sizes.reduce((widest, size) => Math.max(widest, size), 0);
  }
}
