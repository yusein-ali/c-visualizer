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
