import { CellModel, StepModel } from '../src/core';
import { exec, outputOf, rowNamed } from './library';

/**
 * Addresses as a program observes them: printed with `%p`, converted to an
 * integer, and compared or subtracted as bytes. The engine keeps a word in
 * front of every structure's members that C does not have, and lays the
 * members out without padding; the canvas draws C's layout. A program that
 * looks at an address sees the canvas's.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <stddef.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

/** The address the canvas gives an object, from its address cell. */
const addressOf = (model: StepModel, name: string): number =>
  rowNamed(model, name).find((cell) => cell.kind === 'address')!.address!;

const rows = (model: StepModel): CellModel[][] => [
  ...model.stacks.flatMap((stack) => stack.rows),
  ...model.memory.flatMap((segment) => segment.rows),
];

describe('member offsets observed through byte pointers', () => {
  it('measures a structure on the heap from its address', async () => {
    expect(
      await outputOf(
        program(
          `  struct student *susan = malloc(sizeof(struct student));
  (*susan).name = NULL;
  susan->points[0] = 7;
  printf("%d %d %d\\n", (int)((char *)&susan->name - (char *)susan),
         (int)((char *)&susan->points[0] - (char *)susan), (int)sizeof(struct student));
  printf("%d\\n", susan->points[0]);
  free(susan);`,
          'struct student { char *name; int points[3]; };'
        )
      )
    ).toBe('0 4 16\n7\n');
  });

  it('steps over an array of structures by their size', async () => {
    expect(
      await outputOf(
        program(
          `  struct pair arr[2] = {{1, 2}, {3, 4}};
  struct pair *p = arr;
  printf("%d %d %d\\n", (int)((char *)&arr[1] - (char *)arr), (int)((char *)&p->b - (char *)p), p[1].b);`,
          'struct pair { int a; int b; };'
        )
      )
    ).toBe('8 4 4\n');
  });

  it('counts the padding before an aligned member, and offsetof agrees', async () => {
    expect(
      await outputOf(
        program(
          `  struct s v = {'a', 1};
  printf("%d %d\\n", (int)((char *)&v.c - (char *)&v), (int)((char *)&v.i - (char *)&v));
  printf("%d %d\\n", &v.c == (char *)&v, (int)offsetof(struct s, i));`,
          'struct s { char c; int i; };'
        )
      )
    ).toBe('0 4\n1 4\n');
  });

  it('keeps typed pointer arithmetic over structures as it was', async () => {
    expect(
      await outputOf(
        program(
          `  struct pair arr[3] = {{1, 2}, {3, 4}, {5, 6}};
  struct pair *end = arr + 3;
  int sum = 0;
  for (struct pair *p = arr; p < end; p++) {
    sum += p->b;
  }
  printf("%d %d\\n", sum, (int)(end - arr));`,
          'struct pair { int a; int b; };'
        )
      )
    ).toBe('12 3\n');
  });
});

describe('%p', () => {
  it('prints the addresses the canvas shows', async () => {
    const run = await exec(
      program(`  int a = 1;
  const char *s = "Dune";
  printf("%p %p\\n", (void *)&a, (void *)s);`)
    );
    const [object, literal] = run.output.trim().split(' ');
    expect(Number(object)).toBe(addressOf(run.model, 'a'));
    const dune = rows(run.model).find((cells) =>
      cells.some((cell) => cell.kind === 'value' && cell.text === 'Dune\\0')
    );
    const shown = dune?.find((cell) => cell.kind === 'address')?.address;
    expect(Number(literal)).toBe(shown);
  });

  it('prints a structure and its first member at one address', async () => {
    const run = await exec(
      program(
        `  struct s v = {'a', 1};
  printf("%p %p %p\\n", (void *)&v, (void *)&v.c, (void *)&v.i);`,
        'struct s { char c; int i; };'
      )
    );
    const [whole, first, second] = run.output.trim().split(' ').map(Number);
    expect(first).toBe(whole);
    expect(second - whole).toBe(4);
    expect(whole).toBe(addressOf(run.model, 'v'));
  });

  it('converts an address to an integer as %p prints it', async () => {
    const run = await exec(
      program(`  int a = 1;
  uintptr_t u = (uintptr_t)&a;
  int *back = (int *)u;
  printf("%p %lx %d\\n", (void *)&a, (unsigned long)u, *back);`)
    );
    const [pointer, integer, value] = run.output.trim().split(' ');
    expect(Number(pointer)).toBe(parseInt(integer, 16));
    expect(value).toBe('1');
  });
});

describe('a structure on the heap', () => {
  it('is drawn as one object, its members at their C offsets', async () => {
    const run = await exec(
      program(
        `  struct student *susan = malloc(sizeof(struct student));
  susan->name = NULL;
  susan->points[0] = 7;
  printf("%d\\n", susan->points[0]);`,
        'struct student { char *name; int points[3]; };'
      )
    );
    expect(run.output).toBe('7\n');
    const heap =
      run.model.memory.find((segment) => segment.key === 'heap')?.rows ?? [];
    const record = heap.find((row) =>
      row.some((cell) => cell.kind === 'type' && cell.text === 'struct student')
    )!;
    const start = record.find((cell) => cell.kind === 'address')!.address!;
    const type = record.find((cell) => cell.kind === 'type')!;
    expect(type.size).toBe(16);
    const at = (name: string): number =>
      heap
        .find((row) =>
          row.some((cell) => cell.kind === 'name' && cell.text === name)
        )!
        .find((cell) => cell.kind === 'address')!.address! - start;
    expect([
      at('name'),
      at('points'),
      at('points[0]'),
      at('points[2]'),
    ]).toEqual([0, 4, 4, 12]);
    // No cell of the record is drawn on its own, as a nameless word.
    expect(
      heap.filter((row) =>
        row.some((cell) => cell.kind === 'name' && /^Heap:/.test(cell.text))
      )
    ).toHaveLength(1);
  });
});
