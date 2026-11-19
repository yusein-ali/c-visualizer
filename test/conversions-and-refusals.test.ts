import { exec, outputOf, rulesOf } from './library';

/**
 * What C converts, and what it refuses, where the engine did neither.
 *
 * A function's value was its `return` expression as it was, not converted to
 * the return type. `*p` on a `void *` read whatever cell was there, where gcc
 * refuses the program. And `assert` checked its condition whatever `NDEBUG`
 * said.
 */

describe('a return value', () => {
  it("is converted to the function's return type", async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdint.h>
typedef unsigned char byte;
unsigned char next(unsigned char v) { return v + 1; }
short narrow(int v) { return v; }
char letter(int v) { return v; }
int whole(double d) { return d; }
double half(int n) { return n; }
float third(void) { return 1.0 / 3; }
byte wrap(int v) { return v; }
uint8_t wrap8(int v) { return v; }
const char *name(void) { return "ok"; }
int *same(int *p) { return p; }
long long big(void) { return 4000000000LL; }
unsigned u(void) { return -1; }
int main(void) {
  int x = 5;
  printf("%d %d %d %d %d\\n", next(255), narrow(70000), letter(321), whole(2.7), whole(-2.7));
  printf("%.1f %.1f %d %d %s %d\\n", half(7) / 2, half(3), wrap(300), wrap8(257), name(), *same(&x));
  printf("%lld %u %.6f\\n", big(), u(), third());
  return 0;
}`)
    ).toBe(
      '0 4464 65 2 -2\n3.5 3.0 44 1 ok 5\n4000000000 4294967295 0.333333\n'
    );
  });
});

describe('a void pointer', () => {
  it('cannot be dereferenced', async () => {
    const run = await exec(`#include <stdio.h>
int main(void) { int pages = 310; const void *p = &pages; printf("%d\\n", *p); return 0; }`);
    expect(run.output).toBe('');
    expect(run.response.errors).toEqual([
      expect.objectContaining({
        line: 2,
        msg: expect.stringContaining('p is a void pointer'),
      }),
    ]);
  });

  it('cannot be subscripted', async () => {
    const run = await exec(`#include <stdio.h>
int compare(const void *a, const void *b) { return a[0] - *(const int *)b; }
int main(void) { int x = 1, y = 2; printf("%d\\n", compare(&x, &y)); return 0; }`);
    expect(run.response.errors).toEqual([
      expect.objectContaining({
        msg: expect.stringContaining('a is a void pointer'),
      }),
    ]);
  });

  it('is stepped a byte at a time and read once converted', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void) {
  int pages[2] = {310, 7};
  void *p = pages;
  void **pp = &p;
  const int *q = p;
  const unsigned char *b = (const unsigned char *)p + 1;
  void *next = (char *)p + sizeof pages[0];
  printf("%d %d %d %d %d\\n", *q, *(const int *)p, *pp == p, *b, *(int *)next);
  return 0;
}`)
    ).toBe('310 310 1 1 7\n');
  });
});

describe('assert', () => {
  it('is ((void)0) where NDEBUG is defined, and its argument is not evaluated', async () => {
    const run = await exec(`#define NDEBUG
#include <assert.h>
#include <stdio.h>
int main(void) { int x = 0; assert(x == 1); assert(++x); printf("passed %d\\n", x); return 0; }`);
    expect(run.output).toBe('passed 0\n');
    expect(rulesOf(run)).toEqual([]);
  });

  it('is redefined by each inclusion of <assert.h>', async () => {
    const run = await exec(`#include <assert.h>
#include <stdio.h>
int main(void) {
  int x = 0;
  assert(x == 0);
#define NDEBUG
#include <assert.h>
  assert(x == 1);
  printf("off\\n");
#undef NDEBUG
#include <assert.h>
  assert(x == 5);
  printf("unreached\\n");
  return 0;
}`);
    expect(run.output).toBe(
      'off\nAssertion failed: x == 5, file main.c, line 12\n'
    );
    expect(rulesOf(run)).toEqual(['assertion-failed']);
  });
});
