import { exec, outputOf, rulesOf } from './library';

/**
 * Constructs the C reference's examples use that the interpreter refused or
 * computed differently from gcc. Where a size depends on the data model, the
 * expectation is this interpreter's: ILP32, `long` and pointers four bytes.
 */

describe('a pointer to an array declared as an object', () => {
  it('points into a heap block of rows and into a declared array', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdlib.h>
int main(void) {
  int (*row)[3] = malloc(2 * sizeof *row);
  row[1][2] = 5;
  row[0][0] = 1;
  int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
  int (*g)[3] = grid;
  printf("%d %d %d %zu\\n", row[1][2], g[1][1], (*(g + 1))[2], sizeof *row);
  free(row);
  return 0;
}`)
    ).toBe('5 5 6 12\n');
  });

  it('is filled through a parameter of the same type', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdlib.h>
void fill(int (*row)[3], int n) { for (int i = 0; i < n; i++) for (int j = 0; j < 3; j++) row[i][j] = i * 10 + j; }
int sum(int (*row)[3], int n) { int s = 0; for (int i = 0; i < n; i++) for (int j = 0; j < 3; j++) s += row[i][j]; return s; }
int main(void) {
  int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
  int (*heap)[3] = malloc(2 * sizeof(int[3]));
  fill(heap, 2);
  printf("%d %d %zu %zu %zu\\n", sum(grid, 2), heap[1][2], sizeof(int[3]), sizeof(char[5]), sizeof(int[2][3]));
  free(heap);
  return 0;
}`)
    ).toBe('21 12 12 5 24\n');
  });
});

describe('C11 spellings gcc accepts under -std=c99', () => {
  it('reads hexadecimal floating constants', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void) {
  double d = 0x1.8p1;
  float f = 0x1p-3f;
  double small = 0x1p-10;
  printf("%f %f %g\\n", d, f, small);
  printf("%a %a %a\\n", 0x1.8p1, 0xA.8P0, 1.0);
  return 0;
}`)
    ).toBe('3.000000 0.125000 0.000976562\n0x1.8p+1 0x1.5p+3 0x1p+0\n');
  });

  it('accepts _Noreturn and measures _Alignof', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdlib.h>
struct s { char c; double d; };
_Noreturn void stop(void) { exit(0); }
int main(void) {
  printf("%zu %zu %zu %zu %zu\\n", _Alignof(double), _Alignof(char), _Alignof(int *), _Alignof(struct s), _Alignof(short));
  stop();
}`)
    ).toBe('8 1 4 8 2\n');
  });
});

describe('constants', () => {
  it('have the size their suffix and value give them', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void) {
  printf("%zu %zu %zu %zu %zu %zu\\n", sizeof 10, sizeof 10L, sizeof 10LL, sizeof 10U, sizeof 2147483648, sizeof 0xFFFFFFFF);
  return 0;
}`)
    ).toBe('4 4 8 4 8 4\n');
  });

  it('size arrays by enumeration constants and const integers', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#define ROWS 3
enum { COLS = 4, EXTRA };
static int grid[ROWS][COLS + 1];
int main(void) {
  const int limit = 2;
  int local[limit];
  char pad[EXTRA * 2];
  local[0] = limit;
  switch (ROWS * COLS) {
    case ROWS * COLS:
      puts("12 cells");
      break;
    default:
      break;
  }
  printf("%zu %zu %zu %d\\n", sizeof grid, sizeof local, sizeof pad, local[0]);
  return 0;
}`)
    ).toBe('12 cells\n60 8 10 2\n');
  });
});

describe('the comma operator', () => {
  it('yields its right operand, after its left', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void) {
  int count = 0;
  int last = (count = 5, count + 1);
  int x = (1, 2, 3);
  count = (last++, last * 2);
  for (int i = 0, j = 10; i < j; i += 4, j--) count++;
  printf("%d %d %d\\n", last, x, count);
  return 0;
}`)
    ).toBe('7 3 16\n');
  });
});

describe('an unnamed bit-field', () => {
  it('is padding: no initializer and, of width 0, a new unit', async () => {
    expect(
      await outputOf(`#include <stdio.h>
struct status {
  unsigned int ready : 1;
  unsigned int level : 3;
  unsigned int       : 0;
  unsigned int count : 4;
};
int main(void) {
  struct status s = { 1, 5, 9 };
  printf("%u %u %u\\n", s.ready, s.level, s.count);
  unsigned int nine = 9;
  s.level = nine;
  printf("level = %u size %zu\\n", s.level, sizeof s);
  return 0;
}`)
    ).toBe('1 5 9\nlevel = 1 size 8\n');
  });
});

describe('atexit', () => {
  it('calls the registered functions last first when main returns', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdlib.h>
static void first(void) { puts("first registered"); }
static void second(void) { puts("second registered"); }
int main(void) {
  atexit(first);
  atexit(second);
  puts("main returns");
  return 0;
}`)
    ).toBe('main returns\nsecond registered\nfirst registered\n');
  });

  it('calls them when exit is called from a function', async () => {
    const run = await exec(`#include <stdio.h>
#include <stdlib.h>
static void goodbye(void) { puts("goodbye"); }
static void finish(void) { puts("in finish"); exit(0); }
int main(void) {
  atexit(goodbye);
  finish();
  puts("unreached");
  return 0;
}`);
    expect(run.output).toBe('in finish\ngoodbye\n');
    expect(rulesOf(run)).toEqual([]);
  });
});

describe('the bytes of an object laid where a loop variable was', () => {
  it('are its own when the library copies them', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <string.h>
int main(void) {
  unsigned int value = 0x11223344u;
  const unsigned char *byte = (const unsigned char *)&value;
  for (size_t i = 0; i < sizeof value; ++i) {
    printf("%02x ", (unsigned int)byte[i]);
  }
  printf("\\n");
  float f = 1.0f;
  unsigned int bits;
  memcpy(&bits, &f, sizeof bits);
  printf("1.0f is stored as 0x%08x\\n", bits);
  return 0;
}`)
    ).toBe('44 33 22 11 \n1.0f is stored as 0x3f800000\n');
  });
});
