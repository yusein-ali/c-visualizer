import { CellModel, StepModel } from '../src/core';
import { exec, outputOf, rowNamed } from './library';

/**
 * Brace initializers of structures, as the course's Modules 7 and 8 write
 * them: a string literal given to a `char *` member, a function given to a
 * function-pointer member, an array of structures sized by its initializer
 * (the dispatch table), and an array of a tagless typedef'd structure.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

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

describe('a string literal given to a pointer member', () => {
  it('stores the address of the literal, not its characters', async () => {
    expect(
      await outputOf(
        program(
          `  Book a = {"Dune", 1965};
  printf("%s %d\\n", a.title, a.year);`,
          'typedef struct { char *title; int year; } Book;'
        )
      )
    ).toBe('Dune 1965\n');
  });

  it('points the member at the literal on the canvas', async () => {
    const run = await exec(
      program(
        `  struct book a = {"Dune", 1965};
  printf("%s\\n", a.title);`,
        'struct book { const char *title; int year; };'
      )
    );
    expect(run.output).toBe('Dune\n');
    expect(pointee(run.model, 'title')).toBe('Dune\\0');
  });

  it('is followed through a pointer member: a.next->t', async () => {
    expect(
      await outputOf(
        program(
          `  struct node b = {"Emma", NULL};
  struct node a = {"Dune", &b};
  struct node *h = &a;
  printf("%s %s %s\\n", a.next->t, h->next->t, h->t);`,
          'struct node { char *t; struct node *next; };'
        )
      )
    ).toBe('Emma Emma Dune\n');
  });

  it('keeps the characters of a char array member', async () => {
    expect(
      await outputOf(
        program(
          `  struct book a = {"Dune", "Herbert", 1965};
  printf("%s %s %d %d\\n", a.title, a.author, a.year, (int)sizeof a.title);`,
          'struct book { char title[8]; const char *author; int year; };'
        )
      )
    ).toBe('Dune Herbert 1965 8\n');
  });

  it('stores the address in a nested structure member', async () => {
    expect(
      await outputOf(
        program(
          `  struct loan l = {{"Dune", 1965}, "Ann"};
  printf("%s %d %s\\n", l.book.title, l.book.year, l.reader);`,
          `struct book { const char *title; int year; };
struct loan { struct book book; const char *reader; };`
        )
      )
    ).toBe('Dune 1965 Ann\n');
  });

  it('stores the address under member designators', async () => {
    expect(
      await outputOf(
        program(
          `  struct book a = {.year = 1965, .title = "Dune"};
  printf("%s %d\\n", a.title, a.year);`,
          'struct book { const char *title; int year; };'
        )
      )
    ).toBe('Dune 1965\n');
  });

  it('stores the address in a global structure', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%s %d\\n", first.title, first.year);`,
          `struct book { const char *title; int year; };
struct book first = {"Dune", 1965};`
        )
      )
    ).toBe('Dune 1965\n');
  });
});

describe('a function given to a function-pointer member', () => {
  it('is called through the member', async () => {
    expect(
      await outputOf(
        program(
          `  struct shape s = {"square", sq};
  printf("%s %.1f\\n", s.name, s.area(3.0));`,
          `struct shape { const char *name; double (*area)(double); };
double sq(double s) { return s * s; }`
        )
      )
    ).toBe('square 9.0\n');
  });
});

describe('an array of structures sized by its initializer', () => {
  it('has as many elements as the initializer gives', async () => {
    expect(
      await outputOf(
        program(
          `  struct pair t[] = {{0x41, 1}, {0x42, 2}};
  printf("%d %c %d\\n", t[1].n, t[0].c, (int)(sizeof t / sizeof t[0]));`,
          'struct pair { char c; int n; };'
        )
      )
    ).toBe('2 A 2\n');
  });

  it('runs a dispatch table of commands and functions', async () => {
    expect(
      await outputOf(
        program(
          `  int total = 10;
  for (int i = 0; i < 2; i++) {
    total = table[i].run(total);
  }
  struct command local[] = {{'A', add}, {'S', sub}};
  for (int i = 0; i < (int)(sizeof local / sizeof local[0]); i++) {
    printf("%c=%d ", local[i].key, local[i].run(5));
  }
  printf("%d\\n", total);`,
          `int add(int x) { return x + 1; }
int sub(int x) { return x - 1; }
struct command { char key; int (*run)(int); };
struct command table[] = {{'A', add}, {'S', sub}};`
        )
      )
    ).toBe('A=6 S=4 10\n');
  });

  it('places designated elements and counts to the last one', async () => {
    expect(
      await outputOf(
        program(
          `  struct pair t[] = {[2] = {'C', 3}, [0] = {'A', 1}};
  printf("%d %d %d\\n", (int)(sizeof t / sizeof t[0]), t[2].n, t[1].n);`,
          'struct pair { char c; int n; };'
        )
      )
    ).toBe('3 3 0\n');
  });
});

describe('an array of a tagless typedef structure with a const char * member', () => {
  it('is initialized from string literals and its elements swapped', async () => {
    expect(
      await outputOf(
        program(
          `  Book s[2] = {{"Dune", 1965}, {"Emma", 1815}};
  Book t = s[0];
  s[0] = s[1];
  s[1] = t;
  printf("%s %s %d\\n", s[0].title, s[1].title, s[1].year);`,
          'typedef struct { const char *title; int year; } Book;'
        )
      )
    ).toBe('Emma Dune 1965\n');
  });

  it('draws each element with its members', async () => {
    const run = await exec(
      program(
        `  Book s[2] = {{"Dune", 1965}, {"Emma", 1815}};
  printf("%s\\n", s[1].title);`,
        'typedef struct { const char *title; int year; } Book;'
      )
    );
    expect(run.output).toBe('Emma\n');
    expect(rowNamed(run.model, 's[1]')).toBeDefined();
    expect(pointee(run.model, 'title')).toBe('Dune\\0');
  });
});

describe('a char array member of an element of an array of structures', () => {
  it('prints with %s without a warning, and is still bounded', async () => {
    const run = await exec(
      program(
        `  struct item items[2] = {{"AB12", 1}, {"CD", 2}};
  strcpy(items[1].code, "XYZ");
  for (int i = 0; i < 2; i++) {
    printf("%s %d\\n", items[i].code, items[i].n);
  }`,
        'struct item { char code[8]; int n; };'
      )
    );
    expect(run.output).toBe('AB12 1\nXYZ 2\n');
    expect(run.runtime).toEqual([]);
  });
});
