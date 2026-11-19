import { exec, outputOf } from './library';

/**
 * A `char *` into a wider object reads and writes single bytes of it, least
 * significant first, as gcc's little-endian target lays them out. The engine
 * keeps an `int` as one cell, so `*e` through `char *e = (char *)&c` read the
 * whole int, `*e = 7` replaced it, and `*(e + 1)` named no cell at all.
 */

const program = (body: string): string => `#include <stdio.h>
int main(void) {
${body}
  return 0;
}`;

describe('a char pointer into an int', () => {
  it('reads and writes the bytes it points at', async () => {
    expect(
      await outputOf(
        program(`  int c = 0x01020304;
  char *e = (char *)&c;
  *e = 7;
  printf("%x %d\\n", c, *(e + 1));`)
      )
    ).toBe('1020307 3\n');
  });

  it('walks every byte with a subscript, and writes one', async () => {
    expect(
      await outputOf(
        program(`  unsigned int x = 0x11223344;
  unsigned char *b = (unsigned char *)&x;
  for (int i = 0; i < 4; i++) {
    printf("%02x ", b[i]);
  }
  b[3] = 0xff;
  b[0]++;
  b[1] += 1;
  printf("%x\\n", x);`)
      )
    ).toBe('44 33 22 11 ff223445\n');
  });

  it('reads a negative byte through a signed char', async () => {
    expect(
      await outputOf(
        program(`  int x = -1;
  signed char *s = (signed char *)&x;
  unsigned char *u = (unsigned char *)&x;
  printf("%d %d\\n", s[2], u[2]);`)
      )
    ).toBe('-1 255\n');
  });

  it('looks into the elements of an int array', async () => {
    expect(
      await outputOf(
        program(`  int a[2] = {0x0a0b0c0d, 0x01020304};
  char *p = (char *)a;
  printf("%d %d %d\\n", p[0], p[3], p[4]);`)
      )
    ).toBe('13 10 4\n');
  });

  it('leaves a char array, and an int read as an int, as they were', async () => {
    const run = await exec(
      program(`  char s[4] = "abc";
  char *p = s;
  p[1] = 'X';
  int n = 5;
  int *q = &n;
  *q = 300;
  printf("%s %d\\n", s, n);`)
    );
    expect(run.output).toBe('aXc 300\n');
    expect(run.runtime).toEqual([]);
  });
});

/**
 * A typedef of a character type is a byte pointer too. The engine sized every
 * name it did not know as four bytes, so `uint8_t` arrays were laid out four
 * bytes to an element and a `uint8_t *` stepped four: `b[1]` of `(uint8_t
 * *)&year` read the object after `year`, and `malloc(8)` for a `uint8_t *`
 * made two elements.
 */
describe('a typedef of a character type', () => {
  it('reads the bytes of an int through a uint8_t pointer, in a function too', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdint.h>
int byte_at(uint32_t *value, int index) { return ((uint8_t *)value)[index]; }
int main(void)
{
  int year = 2024;
  uint8_t *b = (uint8_t *)&year;
  uint32_t v = 0x01020304;
  printf("%x %d %d\\n", b[1], byte_at(&v, 0), byte_at(&v, 3));
  return 0;
}`)
    ).toBe('7 4 1\n');
  });

  it("steps through a program's own byte typedefs one byte at a time", async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdint.h>
typedef unsigned char byte;
typedef uint8_t u8;
typedef signed char sbyte;
int byte_at(uint32_t *value, int index) { return ((byte *)value)[index]; }
int main(void)
{
  uint32_t v = 0x01020304;
  int x = -2;
  sbyte *s = (sbyte *)&x;
  printf("%d %d\\n", byte_at(&v, 0), byte_at(&v, 3));
  printf("%d %d\\n", s[0], s[3]);
  u8 *p = (u8 *)&v;
  int sum = 0;
  for (u8 *q = p; q < p + 4; q++) {
    sum += *q;
  }
  printf("%d %d\\n", sum, (int)((p + 3) - p));
  p[2] = 0xff;
  printf("%x\\n", v);
  return 0;
}`)
    ).toBe('4 1\n-2 -1\n10 3\n1ff0304\n');
  });

  it('walks a char array, and an array of its own type, element by element', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdint.h>
typedef unsigned char byte;
int main(void)
{
  char word[] = "dune";
  byte *w = (byte *)word;
  byte arr[3] = {10, 20, 30};
  byte *a = arr;
  a++;
  uint8_t u[4] = {9, 8, 7, 6};
  unsigned char *c = u;
  uint8_t *e = u + 1;
  printf("%c%c %d %d %d %d %d\\n", w[1], *(w + 3), *a, a[1], c[1], e[2], (int)(e - u));
  return 0;
}`)
    ).toBe('ue 20 30 8 6 1\n');
  });

  it('gives a uint8_t block from malloc one element per byte', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
int main(void)
{
  uint8_t *buf = malloc(8);
  for (int i = 0; i < 8; i++) {
    buf[i] = i * 3;
  }
  int16_t h[3] = {1, 2, 3};
  int16_t *hp = h;
  printf("%d %d %d %zu\\n", buf[7], *(buf + 5), hp[2], sizeof h);
  free(buf);
  return 0;
}`)
    ).toBe('21 15 3 6\n');
  });
});

/**
 * A frame that has returned leaves its cells in the engine's memory - a
 * dangling pointer still reads them - and the next objects are laid over
 * them. A byte view took the nearest cell below the address for the object
 * holding it, which after a `for` loop was the loop's dead `i` a byte into
 * `x`: `b[2]` read a byte of `i`, silently, and after a call a dead pointer
 * parameter stopped the read with "could not be executed".
 */
describe('a char pointer into an object laid over a returned frame', () => {
  it('reads the bytes of the live object', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdint.h>
typedef signed char sbyte;
int f(int *value) { return *value; }
void show(char c, int v) {
  unsigned char *b = (unsigned char *)&v;
  printf("%c %d %d %d %d\\n", c, b[0], b[1], b[2], b[3]);
}
int main(void)
{
  for (int i = 0; i < 3; i++) {
    printf("%d", i);
  }
  printf("\\n");
  int x = 0x01020304;
  unsigned char *b = (unsigned char *)&x;
  printf("%d %d %d %d\\n", b[0], b[1], b[2], b[3]);
  int v = 1;
  printf("%d\\n", f(&v));
  int y = -2;
  sbyte *s = (sbyte *)&y;
  printf("%d %d\\n", s[0], s[3]);
  show('k', 0x0a0b0c0d);
  return 0;
}`)
    ).toBe('012\n4 3 2 1\n1\n-2 -1\nk 13 12 11 10\n');
  });
});
