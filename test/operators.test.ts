import { outputOf } from './library';

/**
 * Operators of Modules 3 to 5 that the engine computed otherwise than C:
 * `~` straight before a name, the values and the short circuit of `&&` and
 * `||`, and a do-while whose condition is false from the start.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

describe('~ before a name', () => {
  it('complements the value, alone and inside an expression', async () => {
    expect(
      await outputOf(
        program(`  int a = 5;
  unsigned char m = 0x0f;
  printf("%d %d %d %d\\n", ~a, 3 & ~a, ~~a, (unsigned char)~m);`)
      )
    ).toBe('-6 2 5 240\n');
  });

  it('complements a member and an element', async () => {
    expect(
      await outputOf(
        program(
          `  struct flags f = {1};
  int v[2] = {0, 7};
  printf("%d %d\\n", ~f.bits, ~v[1]);`,
          'struct flags { int bits; };'
        )
      )
    ).toBe('-2 -8\n');
  });
});

describe('&& and ||', () => {
  it('yield 0 or 1', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%d %d %d %d %d\\n", 5 && 7, 0x69 && 0xca, 0 || 9, 0 || 0, 2.5 && 1);
  int x = 3 && 4;
  printf("%d %d\\n", x, (3 || 0) + (4 && 4));`
        )
      )
    ).toBe('1 1 1 0 1\n1 2\n');
  });

  it('leave the right operand unevaluated when the left decides', async () => {
    expect(
      await outputOf(
        program(
          `  int a[3] = {1, 2, 3};
  int j = 0;
  if (j > 0 && a[j - 1] > 0) {
    printf("x\\n");
  }
  int calls = 0;
  int r = (1 || bump(&calls)) + (0 && bump(&calls)) + (0 || bump(&calls));
  int *p = NULL;
  if (p == NULL || *p == 0) {
    printf("null\\n");
  }
  printf("ok %d %d\\n", calls, r);`,
          'int bump(int *n) { *n = *n + 1; return 1; }'
        )
      )
    ).toBe('null\nok 1 2\n');
  });
});

describe('do-while', () => {
  it('runs the body once when the condition is false at the start', async () => {
    expect(
      await outputOf(
        program(`  int n = 0;
  do {
    n = n + 10;
  } while (0);
  int k = 5;
  do k--; while (k > 10);
  printf("%d %d\\n", n, k);`)
      )
    ).toBe('10 4\n');
  });

  it('repeats while the condition holds, and continue tests it', async () => {
    expect(
      await outputOf(
        program(`  int i = 0;
  int odd = 0;
  do {
    i++;
    if (i % 2 == 0) {
      continue;
    }
    odd++;
  } while (i < 5);
  printf("%d %d\\n", i, odd);`)
      )
    ).toBe('5 3\n');
  });
});
