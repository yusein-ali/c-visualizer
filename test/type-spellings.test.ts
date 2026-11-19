import { exec, outputOf } from './library';

/**
 * Declarations the parser read wrongly, or not at all.
 *
 * `unsigned g` as a parameter, or `unsigned total;` without an initializer,
 * was read as two type specifiers and no declarator, so the name was not
 * declared. An array length that is a constant expression but no literal
 * (`[N + 1]`, `[sizeof a]`) collapsed the declaration. `_Static_assert` was
 * refused by the grammar at its `sizeof`. And a `const` in a cast in the
 * initializer was read as the pointer's own, so `p++` was refused.
 */

describe('plain unsigned', () => {
  it('declares a parameter, a global and a local', async () => {
    expect(
      await outputOf(`#include <stdio.h>
unsigned total;
unsigned twice(unsigned g);
unsigned f(unsigned g) { return g; }
void show(const unsigned interval, unsigned long s, unsigned char c, unsigned short h, signed q) {
  printf("%u %lu %d %u %d\\n", interval, s, c, h, q);
}
unsigned twice(unsigned g) { unsigned doubled; doubled = 2 * g; return doubled; }
int main(void) {
  unsigned x = f(5);
  total = x + twice(4);
  show(1, 2, 3, 4, -5);
  printf("%u %u %u\\n", x, total, (unsigned)-1);
  return 0;
}`)
    ).toBe('1 2 3 4 -5\n5 13 4294967295\n');
  });
});

describe('an array length that is a constant expression', () => {
  it('is worked out from constants, sizeof and initializers', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <string.h>
#define LEN 4
typedef struct book { char *title; int year; } Book;
typedef unsigned char byte;
struct pad { char c; int i; };
int table[] = {10, 20, 30, 40, 50};
const char greeting[] = "hello";
int main(void) {
  int a = 5;
  unsigned char buf[sizeof a];
  char line[sizeof(Book) * 2];
  int counts[sizeof table / sizeof table[0]];
  char name[LEN + 1];
  byte raw[sizeof(struct pad)];
  char copy[sizeof greeting];
  double grid[2][LEN * 2];
  memcpy(buf, &a, sizeof a);
  strcpy(name, "abcd");
  strcpy(copy, greeting);
  counts[4] = 7;
  grid[1][7] = 1.5;
  printf("%zu %zu %zu %zu %zu %zu %zu\\n", sizeof buf, sizeof line, sizeof counts,
         sizeof name, sizeof raw, sizeof copy, sizeof grid);
  printf("%d %s %s %d %.1f\\n", buf[0], name, copy, counts[4], grid[1][7]);
  return 0;
}`)
    ).toBe('4 16 20 5 8 6 128\n5 abcd hello 7 1.5\n');
  });

  it('follows C precedence: a shift binds looser than an addition', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void) {
  char a[1 << 2 + 1];
  char b[(1 << 2) + 1];
  printf("%zu %zu\\n", sizeof a, sizeof b);
  return 0;
}`)
    ).toBe('8 5\n');
  });
});

describe('_Static_assert', () => {
  it('lets a program whose assertions hold run', async () => {
    expect(
      await outputOf(`#include <stdio.h>
typedef struct book { char *title; int year; } Book;
_Static_assert(sizeof(int) == 4, "an int must take four bytes");
_Static_assert(sizeof(Book) == 8 && sizeof(char) == 1, "a book is two words");
int main(void) {
  int a = 3;
  _Static_assert(sizeof a == 4, "a is an int");
  printf("ok\\n");
  return 0;
}`)
    ).toBe('ok\n');
  });

  it('refuses the program with gcc message when one fails', async () => {
    const run = await exec(`#include <stdio.h>
_Static_assert(sizeof(int) == 8, "an int must take eight bytes");
int main(void) { printf("ok\\n"); return 0; }`);
    expect(run.output).toBe('');
    expect(run.response.errors).toEqual([
      expect.objectContaining({
        line: 2,
        msg: expect.stringContaining(
          'static assertion failed: "an int must take eight bytes"'
        ),
      }),
    ]);
  });
});

describe('a pointer to const', () => {
  it('can be moved when the initializer casts to it', async () => {
    expect(
      await outputOf(`#include <stdio.h>
struct inner { char a; int b; };
int main(void) {
  int x = 0x0102;
  const unsigned char *r = (const unsigned char *)&x;
  r++;
  const char *s = (const char *)&x;
  s++;
  struct inner o = {1, 2};
  int count = 0;
  for (const unsigned char *q = (const unsigned char *)&o; q < (const unsigned char *)&o + sizeof o; q++) {
    count++;
  }
  printf("%d %d %d\\n", *r, *s, count);
  return 0;
}`)
    ).toBe('1 1 8\n');
  });
});
