import { exec, outputOf, valueOf } from './library';

/*
 * A compound assignment evaluates its target and its right side once each.
 *
 * The stock engine tried `x += e` as an operator of its own, failed, and then
 * computed `x + e` - evaluating `e` a second time - so `x += f()` called `f`
 * twice and `total += va_arg(ap, int)` read two arguments per turn. Any
 * target but a plain name went through a separate path that already
 * evaluated once; both are one path now.
 */

const counted = (body: string, globals = ''): string => `#include <stdio.h>
int calls = 0;
int f(int v) { calls++; return v; }
${globals}
int main(void) {
${body}
  return 0;
}
`;

describe('a compound assignment to a name', () => {
  it('calls a function on its right side once', async () => {
    const run = await exec(
      counted(`  int x = 1;
  x += f(5);
  printf("%d %d\\n", x, calls);`)
    );
    expect(run.output).toBe('6 1\n');
    expect(run.runtime).toEqual([]);
    expect(valueOf(run.model, 'x')).toBe('6');
    expect(valueOf(run.model, 'calls')).toBe('1');
    // One write, from what the name held to what it holds now.
    expect(run.model.mutations.filter((one) => one.target === 'x')).toEqual([
      expect.objectContaining({ before: '1', after: '6' }),
    ]);
  });

  it('evaluates the right side once for every operator', async () => {
    expect(
      await outputOf(
        counted(`  int x = 100;
  x += f(20);
  x -= f(6);
  x *= f(2);
  x /= f(4);
  x %= f(50);
  x &= f(60);
  x |= f(3);
  x ^= f(5);
  printf("%d %d\\n", x, calls);`)
      )
    ).toBe('2 8\n');
  });

  it('converts to the type of the name it stores into', async () => {
    expect(
      await outputOf(
        counted(`  unsigned char c = 250;
  c += f(10);
  double d = 1.5;
  d *= f(3);
  int i = 7;
  i /= f(2);
  printf("%d %.1f %d %d\\n", c, d, i, calls);`)
      )
    ).toBe('4 4.5 3 3\n');
  });

  it('reads one variadic argument per va_arg', async () => {
    const run = await exec(`#include <stdio.h>
#include <stdarg.h>
int total(int count, ...) {
  va_list ap;
  va_start(ap, count);
  int sum = 0;
  for (int i = 0; i < count; i++) {
    sum += va_arg(ap, int);
  }
  va_end(ap);
  return sum;
}
int main(void) {
  printf("%d\\n", total(3, 10, 20, 30));
  return 0;
}
`);
    expect(run.output).toBe('60\n');
    expect(run.runtime).toEqual([]);
  });
});

describe('a compound assignment to any other object', () => {
  it('evaluates the target and the right side once each', async () => {
    const run = await exec(
      counted(
        `  int a[3] = {1, 2, 3};
  int i = 0;
  a[i++] += f(10);
  struct S s = {5, 6};
  s.m -= f(1);
  struct S *p = &s;
  p->n *= f(2);
  int k = 7;
  int *q = &k;
  *q += f(3);
  printf("%d %d %d %d %d %d %d\\n", a[0], a[1], i, s.m, s.n, k, calls);`,
        'struct S { int m; int n; };'
      )
    );
    expect(run.output).toBe('11 2 1 4 12 10 4\n');
    expect(run.runtime).toEqual([]);
    expect(valueOf(run.model, 'a[0]')).toBe('11');
    expect(valueOf(run.model, 'i')).toBe('1');
    expect(valueOf(run.model, 'k')).toBe('10');
    const writes = run.model.mutations.map(({ target, before, after }) => ({
      target,
      before,
      after,
    }));
    expect(writes).toEqual(
      expect.arrayContaining([
        { target: 'a[0]', before: '1', after: '11' },
        { target: 's.m', before: '5', after: '4' },
        { target: 'p->n', before: '6', after: '12' },
        { target: '*q', before: '7', after: '10' },
      ])
    );
    // `i++` in the subscript is one write too.
    expect(writes.filter((one) => one.target === 'i')).toEqual([
      { target: 'i', before: '0', after: '1' },
    ]);
  });
});
