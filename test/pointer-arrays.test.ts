import { CellModel, StepModel } from '../src/core';
import { exec, outputOf, rowNamed, targetOf, typeOf, valueOf } from './library';

/*
 * An array of pointers is an array (`char *names[3]` is three `char *`).
 *
 * `Scope.setTop` took any `char *` given a list of values for a string
 * literal being stored, so `char *names[3]` became one `char *` holding the
 * initializers' bytes: `sizeof names` was 4, `names[1]` read a character and
 * printing it stopped the program. And an assignment of a literal to a
 * pointer stored the literal's bytes in the pointer instead of its address.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
${globals}
int main(void) {
${body}
  return 0;
}
`;

const rows = (model: StepModel): CellModel[][] => [
  ...model.stacks.flatMap((stack) => stack.rows),
  ...model.memory.flatMap((segment) => segment.rows),
];

/** What the row a pointer's arrow lands on holds: a literal's text, say. */
const pointee = (model: StepModel, name: string): string => {
  const key = rowNamed(model, name).find(
    (cell) => cell.kind === 'value'
  )?.pointerTarget;
  const row = rows(model).find((cells) =>
    cells.some((cell) => cell.key === key)
  );
  return row?.find((cell) => cell.kind === 'value')?.text ?? '';
};

/** The address the canvas gives an object, from its address cell. */
const addressOf = (model: StepModel, name: string): number =>
  rowNamed(model, name).find((cell) => cell.kind === 'address')!.address!;

describe('an array of char pointers', () => {
  const code = program(`  char *names[] = {"ann", "bob", "cy"};
  int after = 1;
  printf("%d %d\\n", (int)sizeof(names), (int)(sizeof names / sizeof names[0]));
  printf("%s %s %s %c\\n", names[0], names[1], names[2], names[2][1]);
  names[1] = "zed";
  printf("%s\\n", names[1]);`);

  it('holds one pointer per initializer', async () => {
    const run = await exec(code);
    expect(run.output).toBe('12 3\nann bob cy y\nzed\n');
    expect(run.runtime).toEqual([]);
  });

  it('is drawn as an array, each element with its arrow', async () => {
    const { model } = await exec(code);
    expect(typeOf(model, 'names')).toBe('char*[3]');
    expect(pointee(model, 'names[0]')).toBe('ann\\0');
    expect(pointee(model, 'names[1]')).toBe('zed\\0');
    expect(pointee(model, 'names[2]')).toBe('cy\\0');
    // Three elements of four bytes, and the next object after them.
    expect(addressOf(model, 'names[1]') - addressOf(model, 'names[0]')).toBe(4);
    expect(addressOf(model, 'after') - addressOf(model, 'names[0]')).toBe(12);
  });

  it('records an element assignment as the addresses the canvas shows', async () => {
    const { model } = await exec(code);
    const write = model.mutations.find((one) => one.target === 'names[1]');
    expect(write).toBeDefined();
    expect(write!.after).toBe(valueOf(model, 'names[1]'));
    expect(write!.before).toMatch(/^0x2[0-9A-F]{3}$/);
  });
});

describe('arrays of other pointers', () => {
  it('assigns, initializes and leaves an unset element null', async () => {
    const run = await exec(
      program(
        `  int a = 1, b = 2, c = 3;
  int *ps[3];
  ps[0] = &a;
  ps[1] = &b;
  ps[2] = &c;
  const char *pair[3] = {"x", "y"};
  printf("%d %d %d %d %s %s %d %s\\n", *ps[0], *ps[1], *ps[2], (int)sizeof ps,
         pair[0], pair[1], pair[2] == NULL, days[1]);`,
        'const char *days[] = {"mon", "tue"};'
      )
    );
    expect(run.output).toBe('1 2 3 12 x y 1 tue\n');
    expect(run.runtime).toEqual([]);
    expect(targetOf(run.model, 'ps[1]')).toBe('b');
    expect(valueOf(run.model, 'pair[2]')).toBe('0x0');
    expect(targetOf(run.model, 'pair[2]')).toBeNull();
    expect(pointee(run.model, 'days[0]')).toBe('mon\\0');
  });

  it('lays out two dimensions and designated elements', async () => {
    expect(
      await outputOf(
        program(`  char *grid[2][2] = {{"a", "b"}, {"c", "d"}};
  char *picks[3] = {[2] = "z", [0] = "w"};
  printf("%s %s %d %s %s %d\\n", grid[1][0], grid[0][1], (int)sizeof grid,
         picks[0], picks[2], picks[1] == NULL);`)
      )
    ).toBe('c b 16 w z 1\n');
  });
});

describe('an array of strings handed to a function', () => {
  const code = program(
    `  char *names[] = {"cy", "ann", "bob"};
  show(names, 3);
  qsort(names, 3, sizeof(char *), compare);
  show(names, 3);`,
    `int compare(const void *a, const void *b) {
  return strcmp(*(const char **)a, *(const char **)b);
}
void show(char **list, int n) {
  for (int i = 0; i < n; i++) {
    printf("%s ", list[i]);
  }
  printf("\\n");
}`
  );

  it('is read through a char ** and sorted by qsort', async () => {
    const run = await exec(code);
    expect(run.output).toBe('cy ann bob \nann bob cy \n');
    expect(run.runtime).toEqual([]);
    expect(pointee(run.model, 'names[0]')).toBe('ann\\0');
    expect(pointee(run.model, 'names[2]')).toBe('cy\\0');
  });

  it('records the sort as the addresses the canvas shows', async () => {
    const { model } = await exec(code);
    const sort = model.mutations.find((one) => one.target === 'names');
    expect(sort).toBeDefined();
    const shown = ['names[0]', 'names[1]', 'names[2]'].map((name) =>
      valueOf(model, name)
    );
    expect(sort!.after).toBe(`{${shown.join(', ')}}`);
  });
});

describe('a string literal assigned to a pointer', () => {
  it('stores the address of the literal', async () => {
    const run = await exec(
      program(
        `  char *s;
  s = "hi";
  struct N n;
  n.label = "yo";
  printf("%s %s %d\\n", s, n.label, msg == NULL);`,
        'char *msg = "first";\nstruct N { char *label; };'
      )
    );
    expect(run.output).toBe('hi yo 0\n');
    expect(run.runtime).toEqual([]);
    expect(typeOf(run.model, 's')).toBe('char *');
    expect(pointee(run.model, 's')).toBe('hi\\0');
    expect(pointee(run.model, 'label')).toBe('yo\\0');
    // A first global literal is not at address 0, the null pointer.
    expect(pointee(run.model, 'msg')).toBe('first\\0');
  });
});
