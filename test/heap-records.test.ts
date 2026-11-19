import { CellModel, StepModel } from '../src/core';
import { exec, rowNamed } from './library';

/*
 * A heap block of records holds as many as it has room for.
 *
 * The stock `malloc` carved one record whatever size it was asked for, so
 * `ps[1].x` on `malloc(n * sizeof(struct P))` wrote outside every object and
 * ended the statement; `calloc` and `realloc` were built on it. The block is
 * laid out as n records the first time a record pointer takes it, from the
 * size the program asked for, and each record is drawn on the heap as C lays
 * it out: one object with its members, the records one C size apart, though
 * the engine keeps a word in front of each record's members.
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

/** Whether a heap row is a member of the record drawn above it. */
const isMember = (row: CellModel[]): boolean =>
  row.some((cell) => cell.kind === 'indent');

/**
 * The record a pointer's arrow lands in, by the name of its heap row: a
 * pointer to a record lands on its first member, which shares its address.
 */
const heapTarget = (model: StepModel, name: string): string | null => {
  const key = rowNamed(model, name).find(
    (cell) => cell.kind === 'value'
  )?.pointerTarget;
  const rows = heapRows(model);
  let at = rows.findIndex((cells) => cells.some((cell) => cell.key === key));
  while (at > 0 && isMember(rows[at])) {
    at -= 1;
  }
  return at === -1
    ? null
    : (rows[at].find((cell) => cell.kind === 'name')?.text ?? null);
};

/** The rows of a heap record's members, after the record's own row. */
const membersOf = (model: StepModel, record: string): CellModel[][] => {
  const rows = heapRows(model);
  const at = rows.findIndex((cells) =>
    cells.some((cell) => cell.kind === 'name' && cell.text === record)
  );
  const members: CellModel[][] = [];
  for (let next = at + 1; at !== -1 && next < rows.length; next += 1) {
    if (!isMember(rows[next])) {
      break;
    }
    members.push(rows[next]);
  }
  return members;
};

/** What the canvas writes for one member of a heap record. */
const memberValue = (
  model: StepModel,
  record: string,
  member: string
): string | undefined =>
  membersOf(model, record)
    .find((row) =>
      row.some((cell) => cell.kind === 'name' && cell.text === member)
    )
    ?.find((cell) => cell.kind === 'value')?.text;

/** The address the canvas gives a heap row. */
const heapAddress = (model: StepModel, name: string): number | undefined =>
  heapRows(model)
    .find((row) =>
      row.some((cell) => cell.kind === 'name' && cell.text === name)
    )
    ?.find((cell) => cell.kind === 'address')?.address;

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
    // Named for where the engine keeps them: a descriptor word and two
    // members, twelve engine bytes a record.
    expect(descriptors(model, 'struct P')).toEqual([
      'Heap:20000',
      'Heap:20012',
      'Heap:20024',
    ]);
    expect(memberValue(model, 'Heap:20012', 'x')).toBe('1');
    expect(memberValue(model, 'Heap:20012', 'y')).toBe('10');
    expect(memberValue(model, 'Heap:20024', 'x')).toBe('99');
    expect(memberValue(model, 'Heap:20024', 'y')).toBe('20');
    // Drawn where C puts them: eight bytes a record, x at 0 and y at 4.
    const first = heapAddress(model, 'Heap:20000')!;
    expect(heapAddress(model, 'Heap:20012')! - first).toBe(8);
    expect(heapAddress(model, 'Heap:20024')! - first).toBe(16);
    const second = membersOf(model, 'Heap:20012').map(
      (row) => row.find((cell) => cell.kind === 'address')!.address! - first
    );
    expect(second).toEqual([8, 12]);
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
    expect(memberValue(run.model, 'Heap:20012', 'x')).toBe('5');
    expect(memberValue(run.model, 'Heap:20024', 'y')).toBe('6');
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
    expect(memberValue(run.model, 'Heap:20040', 'x')).toBe('2');
    expect(memberValue(run.model, 'Heap:20040', 'y')).toBe('uninitialized');
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
