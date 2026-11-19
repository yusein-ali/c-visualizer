import { RecordTable } from './RecordTable';

/**
 * `union` layout: in C every member starts at the same place, and the record
 * is as wide as its widest member, rounded up to its strictest alignment.
 *
 * That is the layout `sizeof` and the canvas count (`displayFieldsOf`). The
 * engine cannot store it as it is: its memory is a map of typed cells, one
 * per scalar, so two members at one address would be two cells at one key,
 * and a record member carries a descriptor word C does not have. Each member
 * is therefore given storage of its own in the engine, one after another as
 * a struct's members are, and `UnionStorage` keeps them all holding the same
 * bytes: after a store into one member, every other member is decoded again
 * from the bytes C would now hold at its offsets. Writing `0x01020304` to a
 * `uint32_t` member and reading a `uint8_t[4]` one gives 4, 3, 2, 1.
 */
export class UnionTable extends RecordTable {
  protected readonly keyword = 'union';

  protected offsetsOf(sizes: number[]): number[] {
    let next = 0;
    return sizes.map((size) => {
      const offset = next;
      next += size;
      return offset;
    });
  }

  protected sizeOfAll(sizes: number[]): number {
    return sizes.reduce((total, size) => total + size, 0);
  }
}
