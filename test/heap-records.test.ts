import { CellModel, StepModel } from '../src/core';
import { exec, rowNamed, typeOf, valueOf } from './library';

/*
 * A heap block of records holds as many as it has room for.
 *
 * The stock `malloc` carved one record whatever size it was asked for, so
 * `ps[1].x` on `malloc(n * sizeof(struct P))` wrote outside every object and
 * ended the statement; `calloc` and `realloc` were built on it. The block is
 * laid out as n records the first time a record pointer takes it, from the
 * size the program asked for, and each record is drawn on the heap as a
 * descriptor row followed by its members.
 */

const program = (body: string, globals: string): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
${globals}
int main(void) {
${body}
  return 0;
}
`;

/** The heap band's rows, by name. */
const heapRows = (model: StepModel): CellModel[][] =>
  model.memory.find((segment) => segment.key === 'heap')?.rows ?? [];

const heapNames = (model: StepModel): string[] =>
  heapRows(model).map(
    (row) => row.find((cell) => cell.kind === 'name')?.text ?? ''
  );

/** The heap rows typed as the record: one per record. */
const descriptors = (model: StepModel, type: string): string[] =>
  heapRows(model)
    .filter((row) =>
      row.some((cell) => cell.kind === 'type' && cell.text === type)
    )
    .map((row) => row.find((cell) => cell.kind === 'name')!.text);

/** The name of the heap row a pointer's arrow lands on. */
const heapTarget = (model: StepModel, name: string): string | null => {
  const key = rowNamed(model, name).find(
    (cell) => cell.kind === 'value'
  )?.pointerTarget;
  const row = heapRows(model).find((cells) =>
    cells.some((cell) => cell.key === key)
  );
  return row?.find((cell) => cell.kind === 'name')?.text ?? null;
};

const point = 'struct P { int x; int y; };';

describe('malloc of n records', () => {
  const code = program(
    `  int n = 3;
  struct P *ps = malloc(n * sizeof(struct P));
  for (int i = 0; i < n; i++) {
    ps[i].x = i;
    ps[i].y = i * 10;
  }
  (ps + 2)->x = 99;
  struct P *second = &ps[1];
  struct P *third = ps + 2;
  printf("%d %d %d %d %d\\n", ps[1].x, ps[1].y, (ps + 2)->x, ps[2].y,
         (int)(third - ps));`,
    point
  );

  it('reads and writes every record', async () => {
    const run = await exec(code);
    expect(run.output).toBe('1 10 99 20 2\n');
    expect(run.runtime).toEqual([]);
  });

  it('draws each record with its members', async () => {
    const { model } = await exec(code);
    // A descriptor word and two members, twelve engine bytes a record.
    expect(descriptors(model, 'struct P')).toEqual([
      'Heap:20000',
      'Heap:20012',
      'Heap:20024',
    ]);
    expect(valueOf(model, 'Heap:20016')).toBe('1');
    expect(valueOf(model, 'Heap:20020')).toBe('10');
    expect(valueOf(model, 'Heap:20028')).toBe('99');
    expect(valueOf(model, 'Heap:20032')).toBe('20');
    expect(heapTarget(model, 'ps')).toBe('Heap:20000');
    expect(heapTarget(model, 'second')).toBe('Heap:20012');
    expect(heapTarget(model, 'third')).toBe('Heap:20024');
  });

  it('names each member written in the mutation view', async () => {
    const { model } = await exec(code);
    expect(
      model.mutations
        .filter((one) => /^ps\[1\]|^\(ps \+ 2\)/.test(one.target))
        .map(({ target, before, after }) => [target, before, after])
    ).toEqual([
      ['ps[1].x', 'null', '1'],
      ['ps[1].y', 'null', '10'],
      ['(ps + 2)->x', '2', '99'],
    ]);
  });

  it('lays the records out for a pointer assigned the block too', async () => {
    const run = await exec(
      program(
        `  struct P *ps;
  ps = malloc(2 * sizeof(struct P));
  ps[1].y = 5;
  int *after = malloc(sizeof(int));
  *after = 6;
  printf("%d %d\\n", ps[1].y, *after);`,
        point
      )
    );
    expect(run.output).toBe('5 6\n');
    expect(run.runtime).toEqual([]);
    expect(descriptors(run.model, 'struct P')).toEqual([
      'Heap:20000',
      'Heap:20012',
    ]);
    // The next block is carved after both records, not inside the second.
    expect(heapTarget(run.model, 'after')).toBe('Heap:20024');
  });

  it('keeps every record whole when another pointer is declared on it', async () => {
    const run = await exec(
      program(
        `  struct P *ps = malloc(3 * sizeof(struct P));
  ps[1].x = 5;
  ps[2].y = 6;
  struct P *alias = ps;
  printf("%d %d\\n", alias[1].x, alias[2].y);`,
        point
      )
    );
    expect(run.output).toBe('5 6\n');
    expect(descriptors(run.model, 'struct P')).toEqual([
      'Heap:20000',
      'Heap:20012',
      'Heap:20024',
    ]);
    expect(valueOf(run.model, 'Heap:20016')).toBe('5');
    expect(typeOf(run.model, 'Heap:20016')).toBe('int');
  });

  it('takes every record back with free', async () => {
    const run = await exec(
      program(
        `  struct P *ps = malloc(3 * sizeof(struct P));
  ps[2].x = 1;
  free(ps);`,
        point
      )
    );
    expect(run.runtime).toEqual([]);
    expect(heapNames(run.model)).toEqual([]);
  });
});

describe('calloc of n records', () => {
  it('zeroes every member of every record, arrays included', async () => {
    const run = await exec(
      program(
        `  struct N *ns = calloc(3, sizeof(struct N));
  strcpy(ns[2].name, "zoe");
  ns[1].age = 4;
  printf("%s %d %d %d\\n", ns[2].name, ns[1].age, ns[0].age, ns[0].name[0]);`,
        'struct N { char name[4]; int age; };'
      )
    );
    expect(run.output).toBe('zoe 4 0 0\n');
    expect(run.runtime).toEqual([]);
    expect(descriptors(run.model, 'struct N')).toHaveLength(3);
    const values = heapRows(run.model)
      .filter((row) =>
        row.some((cell) => cell.kind === 'type' && cell.text === 'int')
      )
      .map((row) => row.find((cell) => cell.kind === 'value')!.text);
    expect(values).toEqual(['0', '4', '0']);
  });
});

describe('realloc of a block of records', () => {
  it('moves every record and lays out the new ones', async () => {
    const run = await exec(
      program(
        `  struct P *ps = malloc(2 * sizeof(struct P));
  ps[0].x = 1;
  ps[1].x = 2;
  int *g = malloc(sizeof(int));
  *g = 7;
  ps = realloc(ps, 3 * sizeof(struct P));
  ps[2].x = 3;
  printf("%d %d %d %d\\n", ps[0].x, ps[1].x, ps[2].x, *g);`,
        point
      )
    );
    expect(run.output).toBe('1 2 3 7\n');
    expect(run.runtime).toEqual([]);
    // Two records from 20000, the int at 20024, the three from 20028.
    expect(descriptors(run.model, 'struct P')).toEqual([
      'Heap:20028',
      'Heap:20040',
      'Heap:20052',
    ]);
    expect(valueOf(run.model, 'Heap:20044')).toBe('2');
    expect(valueOf(run.model, 'Heap:20048')).toBe('uninitialized');
    expect(
      run.model.mutations.find((one) => one.target === '*ps')
    ).toMatchObject({
      before: '0x4E20, 16 bytes',
      after: 'moved from 0x4E20 to 0x4E3C, 24 bytes',
    });
  });

  it('grows the last block in place', async () => {
    const run = await exec(
      program(
        `  struct P *ps = malloc(sizeof(struct P));
  ps->x = 1;
  ps = realloc(ps, 2 * sizeof(struct P));
  ps[1].x = 2;
  printf("%d %d\\n", ps[0].x, ps[1].x);`,
        point
      )
    );
    expect(run.output).toBe('1 2\n');
    expect(run.runtime).toEqual([]);
    expect(descriptors(run.model, 'struct P')).toEqual([
      'Heap:20000',
      'Heap:20012',
    ]);
  });
});
