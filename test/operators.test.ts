import { bracedDoBodies } from '../src/interpreter/DoWhileBodies';
import { exec, outputOf } from './library';

/**
 * Operators of Modules 3 to 5 that the engine computed otherwise than C:
 * `~` straight before a name, the values and the short circuit of `&&` and
 * `||`, and a do-while whose condition is false from the start, or whose
 * body has no braces.
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

  // unicoen's grammar has a do-while only around a compound statement, and
  // read `do k++; while (k < 3);` by error recovery: the rest of the
  // function became the body, with no condition, and the loop never ended.
  it('repeats a body without braces', async () => {
    expect(
      await outputOf(
        program(`  int k = 0;
  do k++; while (k < 3);
  printf("%d\\n", k);`)
      )
    ).toBe('3\n');
  });

  it('repeats a body without braces that is itself a statement with parts', async () => {
    expect(
      await outputOf(
        program(`  int k = 0, odd = 0, even = 0, total = 0, a = 0, b = 0;
  do if (k % 2) odd++; else even++; while (++k < 5);
  do
    total += k--;
  while (k > 0);
  do do a++; while (a % 2); while (++b < 3);
  do for (int i = 0; i < 2; i++) b++; while (b < 8);
  do if (k == 2) break; else k++; while (1);
  do printf("%d ", k); while (++k < 4);
  printf("%d %d %d %d %d %d\\n", odd, even, total, a, b, k);`)
      )
    ).toBe('2 3 2 3 15 6 9 4\n');
  });

  it('keeps every token of a body without braces where it was', async () => {
    const lines = [
      '  do k++; while (k < 3);',
      '  do',
      '    k = k / z;',
      '  while (k);',
      'do',
      'k++;',
      'while (k < 3);',
      '  do(k++);while(k < 3);',
    ];
    expect(bracedDoBodies(lines.join('\n')).split('\n')).toEqual([
      '  do{k++;}while (k < 3);',
      '  do',
      '   {k = k / z;',
      ' }while (k);',
      'do{',
      'k++;}',
      'while (k < 3);',
      // Packed against both words: the one place a column moves.
      '  do{(k++);}while(k < 3);',
    ]);
    const run = await exec(
      program(`  int k = 4, z = 0;
  do
    k = k / z;
  while (k);`)
    );
    expect(
      run.runtime.map(({ rule, line, column }) => [rule, line, column])
    ).toEqual([['division-by-zero', 6, 4]]);
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
