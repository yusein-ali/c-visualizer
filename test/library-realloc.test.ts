import { libraryHelp } from '../src/app/libraryHelp';
import { StepModel } from '../src/core';
import { exec, outputOf, rulesOf, targetOf, valueOf } from './library';

/**
 * `realloc` (L5): a block grows where it stands only when it is the last one
 * on the heap; otherwise it moves - new block, copied cells, old block freed
 * - and the mutation view says so. A shrink frees the tail.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

const heapRows = (model: StepModel): string[] =>
  model.stacks
    .flatMap((stack) => stack.rows)
    .map((row) => row.find((cell) => cell.kind === 'name')?.text ?? '')
    .filter((name) => name.startsWith('Heap:'));

describe('realloc', () => {
  it('moves a block that cannot grow where it is, and says so', async () => {
    const run = await exec(
      program(`  int *a = malloc(2 * sizeof(int));
  a[0] = 1;
  a[1] = 2;
  int *b = malloc(sizeof(int));
  *b = 9;
  a = realloc(a, 4 * sizeof(int));
  a[2] = 3;
  a[3] = 4;
  printf("%d %d %d %d %d\\n", a[0], a[1], a[2], a[3], *b);`)
    );
    expect(run.output).toBe('1 2 3 4 9\n');
    expect(run.runtime).toEqual([]);
    // The old block's two ints are gone; the new one follows b's int.
    expect(heapRows(run.model)).toEqual([
      'Heap:20008',
      'Heap:20012',
      'Heap:20016',
      'Heap:20020',
      'Heap:20024',
    ]);
    expect(valueOf(run.model, 'Heap:20012')).toBe('1');
    expect(valueOf(run.model, 'Heap:20016')).toBe('2');
    expect(targetOf(run.model, 'a')).toBe('Heap:20012');
    expect(
      run.model.mutations.find((one) => one.target === '*a' && one.line === 10)
    ).toEqual({
      target: '*a',
      frame: 'main',
      before: '0x4E20, 8 bytes',
      after: 'moved from 0x4E20 to 0x4E2C, 16 bytes',
      line: 10,
    });
    // The copy into the new block is the move, not a change of its own.
    expect(
      run.model.mutations
        .filter((one) => one.line === 10)
        .map((one) => one.target)
    ).toEqual(['*a', 'a']);
  });

  it('grows the last block on the heap in place', async () => {
    const run = await exec(
      program(`  int *a = malloc(2 * sizeof(int));
  a[0] = 1;
  a[1] = 2;
  a = realloc(a, 3 * sizeof(int));
  a[2] = 3;
  printf("%d %d %d\\n", a[0], a[1], a[2]);`)
    );
    expect(run.output).toBe('1 2 3\n');
    expect(heapRows(run.model)).toEqual([
      'Heap:20000',
      'Heap:20004',
      'Heap:20008',
    ]);
    expect(targetOf(run.model, 'a')).toBe('Heap:20000');
    expect(
      run.model.mutations.find((one) => one.target === '*a')
    ).toMatchObject({
      before: '0x4E20, 8 bytes',
      after: '0x4E20, 12 bytes (grown in place)',
    });
  });

  it('keeps a shrunk block in place and frees its tail', async () => {
    const run = await exec(
      program(`  int *a = malloc(3 * sizeof(int));
  a[0] = 1;
  a[1] = 2;
  a[2] = 3;
  a = realloc(a, sizeof(int));
  int *b = malloc(sizeof(int));
  *b = 8;
  printf("%d %d\\n", a[0], *b);`)
    );
    expect(run.output).toBe('1 8\n');
    // The freed tail is where the next block is carved.
    expect(targetOf(run.model, 'b')).toBe('Heap:20004');
    expect(heapRows(run.model)).toEqual(['Heap:20000', 'Heap:20004']);
    expect(
      run.model.mutations.find((one) => one.target === '*a')
    ).toMatchObject({ after: '0x4E20, 4 bytes (tail freed)' });
  });

  it('moves a structure member by member', async () => {
    const run = await exec(
      program(
        `  struct P *p = malloc(sizeof(struct P));
  p->x = 1;
  p->y = 2.5;
  int *g = malloc(sizeof(int));
  *g = 7;
  p = realloc(p, 2 * sizeof(struct P));
  printf("%d %.1f %d\\n", p->x, p->y, *g);`,
        'struct P { int x; double y; };'
      )
    );
    expect(run.output).toBe('1 2.5 7\n');
    expect(run.runtime).toEqual([]);
    expect(targetOf(run.model, 'p')).toBe('Heap:20020');
    expect(valueOf(run.model, 'Heap:20024')).toBe('1');
    expect(valueOf(run.model, 'Heap:20028')).toBe('2.5');
    expect(heapRows(run.model)).not.toContain('Heap:20000');
    expect(
      run.model.mutations.find((one) => one.target === '*p')
    ).toMatchObject({ after: 'moved from 0x4E20 to 0x4E34, 32 bytes' });
  });

  it('is malloc for a null pointer, and frees for size 0 with a note', async () => {
    const run = await exec(
      program(`  int *z = realloc(NULL, 2 * sizeof(int));
  z[0] = 4;
  z[1] = 5;
  printf("%d %d\\n", z[0], z[1]);
  z = realloc(z, 0);
  printf("%d\\n", z == NULL);`)
    );
    expect(run.output).toBe('4 5\n1\n');
    expect(rulesOf(run)).toEqual(['realloc-zero-size']);
    expect(run.runtime[0]).toMatchObject({ severity: 'warning', line: 9 });
    expect(heapRows(run.model)).toEqual([]);
    expect(
      run.model.mutations.find((one) => one.target === '*z')
    ).toMatchObject({
      before: '0x4E20, 8 bytes',
      after: 'freed; realloc returned NULL',
    });
  });

  it('refuses a pointer the allocator did not return', async () => {
    const run = await exec(
      program(`  int arr[2];
  int *q = realloc(arr, 16);
  printf("not reached\\n");`)
    );
    expect(rulesOf(run)).toEqual(['invalid-realloc']);
    expect(run.output).not.toContain('not reached');
  });

  it('refuses a pointer into the middle of a block', async () => {
    const run = await exec(
      program(`  int *p = malloc(8);
  p = realloc(p + 1, 16);`)
    );
    expect(rulesOf(run)).toEqual(['invalid-realloc']);
    expect(run.runtime[0].message).toContain('middle of');
  });

  it('refuses a block that has already been freed', async () => {
    const run = await exec(
      program(`  int *p = malloc(8);
  free(p);
  p = realloc(p, 16);`)
    );
    expect(rulesOf(run)).toEqual(['use-after-free']);
  });

  it('copies characters, so a growing string keeps its text', async () => {
    expect(
      await outputOf(
        `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void) {
  char *s = malloc(4);
  strcpy(s, "abc");
  char *t = malloc(2);
  t[0] = 'x';
  t[1] = 0;
  s = realloc(s, 8);
  strcat(s, "def");
  printf("%s %s\\n", s, t);
  return 0;
}`
      )
    ).toBe('abcdef x\n');
  });
});

it('documents realloc', () => {
  expect(libraryHelp('realloc')).toMatchObject({ header: 'stdlib.h' });
});
