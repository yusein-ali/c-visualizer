import { RecordTable } from './RecordTable';

/**
 * `struct` layout: members follow one another, and the record is as wide as all
 * of them together.
 *
 * No padding is inserted. That is not what a real C compiler does, but it is
 * what unicoen.ts's engine already assumes everywhere it walks a record, and a
 * layout that disagreed with the engine would be worse than one that is merely
 * unpadded.
 */
export class StructTable extends RecordTable {
  protected readonly keyword = 'struct';

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
