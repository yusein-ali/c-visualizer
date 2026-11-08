import { CPP14Mapper } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Mapper';
import { libraryHelp } from '../src/app/libraryHelp';
import { narrowToType } from '../src/core';
import { validateAst } from '../src/interpreter/AstValidator';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { exec, outputOf, typeOf, valueOf } from './library';

/**
 * L2: `size_t`, `ptrdiff_t`, `offsetof`, and the `sizeof` that yields one.
 *
 * The widths are the engine's (ILP32: `long` and pointers are four bytes,
 * and `sizeof` says so), so `size_t` is four bytes and unsigned. See
 * `library/types.ts`.
 */

describe('size_t in declarations', () => {
  it('declares objects, loop counters, parameters, return types, arrays and members', async () => {
    const run = await exec(`#include <stdio.h>
#include <stddef.h>
#include <string.h>
struct Buffer { size_t length; char data[8]; };
static size_t calls;
size_t twice(size_t n) {
  calls++;
  return n * 2;
}
int main(void) {
  const size_t limit = 3;
  size_t total = 0;
  size_t sizes[3] = {1, 2, 3};
  struct Buffer b;
  b.length = strlen("hey");
  for (size_t i = 0; i < limit; i++) {
    total = total + twice(sizes[i]);
  }
  printf("%d %d %d\\n", (int)total, (int)b.length, (int)calls);
  return 0;
}`);
    expect(run.output).toBe('12 3 3\n');
    expect(run.response.errors).toEqual([]);
    expect(run.runtime.filter((one) => one.fatal)).toEqual([]);
    expect(typeOf(run.model, 'total')).toBe('size_t');
    expect(typeOf(run.model, 'limit')).toBe('const size_t');
    expect(typeOf(run.model, 'sizes[0]')).toBe('size_t');
  });

  it('casts to size_t and the other typedefs without the syntax check refusing', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stddef.h>
#include <time.h>
int main(void) {
  int n = 7;
  int negative = -2;
  size_t s = (size_t)n;
  time_t t = (time_t)100;
  clock_t c = (clock_t)5;
  ptrdiff_t d = (ptrdiff_t)negative;
  printf("%d %ld %ld %ld\\n", (int)s, (long)t, (long)c, (long)d);
  return 0;
}`)
    ).toBe('7 100 5 -2\n');
  });

  it('draws a size_t as the unsigned type it is', async () => {
    const run = await exec(`#include <stddef.h>
int main(void) {
  size_t wrapped = -1;
  ptrdiff_t back = -1;
  return 0;
}`);
    expect(valueOf(run.model, 'wrapped')).toBe('4294967295');
    expect(valueOf(run.model, 'back')).toBe('-1');
    expect(narrowToType(-1, 'size_t')).toBe(4294967295);
    expect(narrowToType(-1, 'ptrdiff_t')).toBe(-1);
  });

  it('subtracts pointers into a ptrdiff_t', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stddef.h>
int main(void) {
  char text[] = "abcdef";
  char *from = &text[1];
  char *to = &text[5];
  ptrdiff_t gap = to - from;
  printf("%ld\\n", (long)gap);
  return 0;
}`)
    ).toBe('4\n');
  });

  it('is a declaration to the missing-semicolon check', () => {
    const code = [
      'int main(void) {',
      '    size_t n',
      '    n = 3;',
      '    return 0;',
      '}',
    ].join('\n');
    const log = console.log;
    console.log = () => undefined;
    const error = console.error;
    console.error = () => undefined;
    try {
      expect(validateAst(new CPP14Mapper().parseToUniTree(code), code)).toEqual(
        [{ line: 2, column: 12, message: "expected ';' after declaration" }]
      );
    } finally {
      console.log = log;
      console.error = error;
    }
  });

  it('is an integer to the format rules', () => {
    const lint = (code: string) => {
      const log = console.error;
      console.error = () => undefined;
      try {
        return new PlivetCPP14Interpreter()
          .getLints(code)
          .filter((one) => one.rule === 'format-arguments');
      } finally {
        console.error = log;
      }
    };
    const program = (conversion: string) => `#include <stdio.h>
#include <stddef.h>
int main(void) {
  size_t n = 4;
  printf("${conversion}\\n", n);
  return 0;
}`;
    expect(lint(program('%zu'))).toEqual([]);
    expect(lint(program('%s'))).toHaveLength(1);
  });
});

describe('sizeof', () => {
  it('yields the size of arrays, variables, types and expressions', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stddef.h>
struct Point { int x; double y; char tag; };
typedef struct Point Point;
int main(void) {
  int counts[3];
  double d = 1.0;
  struct Point p;
  struct Point *pp = &p;
  int grid[2][3];
  printf("%d %d %d %d\\n", (int)sizeof(counts), (int)sizeof d, (int)sizeof(struct Point), (int)sizeof(Point));
  printf("%d %d %d %d\\n", (int)(sizeof(counts) / sizeof(counts[0])), (int)sizeof(grid[1]), (int)sizeof(pp->y), (int)sizeof(*pp));
  printf("%d %d %d %d\\n", (int)sizeof(size_t), (int)sizeof(char *), (int)sizeof("abc"), (int)sizeof('a'));
  return 0;
}`)
    ).toBe('12 8 24 24\n3 12 8 24\n4 4 4 4\n');
  });

  it('does not evaluate its operand', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void) {
  int values[2] = {1, 2};
  int i = 0;
  int s = (int)sizeof(values[i++]);
  printf("%d %d\\n", s, i);
  return 0;
}`)
    ).toBe('4 0\n');
  });
});

describe('offsetof', () => {
  it('gives the offset the canvas lays the member out at, padding included', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stddef.h>
struct Point { int x; double y; char tag; };
typedef struct Point Point;
int main(void) {
  printf("%d %d %d\\n", (int)offsetof(struct Point, x), (int)offsetof(struct Point, y), (int)offsetof(Point, tag));
  return 0;
}`)
    ).toBe('0 8 16\n');
  });

  it('refuses a member the structure does not have', async () => {
    const run = await exec(`#include <stddef.h>
struct Point { int x; };
int main(void) {
  return (int)offsetof(struct Point, z);
}`);
    expect(run.runtime.map((one) => one.rule)).toEqual(['offsetof-member']);
  });
});

it('documents size_t, ptrdiff_t and offsetof', () => {
  expect(libraryHelp('size_t')).toMatchObject({
    header: 'stddef.h',
    kind: 'type',
    signature: 'typedef unsigned long size_t',
  });
  expect(libraryHelp('ptrdiff_t')).toMatchObject({ header: 'stddef.h' });
  expect(libraryHelp('offsetof')).toMatchObject({
    header: 'stddef.h',
    kind: 'macro',
  });
});
