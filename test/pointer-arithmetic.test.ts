import { exec, outputOf, rowNamed, targetOf, valueOf } from './library';

/*
 * Pointer arithmetic counts elements, not bytes (C11 6.5.6).
 *
 * The engine keeps an address as a plain number and added to it whatever it
 * was given: `p + 1` on an `int *` pointed into the middle of an element,
 * `q - p` counted bytes, and `p++` moved one byte. Every form is scaled by
 * the size of the element now - `p + n`, `n + p`, `p - n`, `p - q`, `p += n`,
 * `p++`, `(p + i)[j]` - for any element type, records included.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stddef.h>
${globals}
int main(void) {
${body}
  return 0;
}
`;

describe('pointer arithmetic on an int array', () => {
  const code = program(`  int v[4] = {10, 20, 30, 40};
  int *p = v;
  int *q = &v[3];
  ptrdiff_t d = q - p;
  printf("%td %d %d\\n", d, *(p + 2), *(2 + p));
  p = p + 1;
  printf("%d\\n", *p);
  p++;
  printf("%d\\n", *p);
  p += 1;
  printf("%d\\n", *p);
  p -= 2;
  printf("%d %d %d\\n", *p, *(q - 1), p[1]);
  printf("%d %d %d %d\\n", q > p, p < q, p == &v[1], q - v);
  int *r = (p + 1) + 1;`);

  it('counts elements', async () => {
    const run = await exec(code);
    expect(run.output).toBe('3 30 30\n20\n30\n40\n20 30 30\n1 1 1 3\n');
    expect(run.runtime).toEqual([]);
  });

  it('leaves every pointer on the element it names', async () => {
    const { model } = await exec(code);
    expect(targetOf(model, 'p')).toBe('v[1]');
    expect(targetOf(model, 'q')).toBe('v[3]');
    expect(targetOf(model, 'r')).toBe('v[3]');
    expect(valueOf(model, 'd')).toBe('3');
  });

  it('records each step of a pointer as the address the canvas shows', async () => {
    const { model } = await exec(code);
    const address = (name: string): string =>
      /\((0x[0-9A-F]+)\)/.exec(
        rowNamed(model, name).find((cell) => cell.kind === 'address')!.text
      )![1];
    const steps = model.mutations
      .filter((one) => one.target === 'p')
      .map(({ before, after }) => [before, after]);
    expect(steps).toEqual([
      [address('v[0]'), address('v[1]')],
      [address('v[1]'), address('v[2]')],
      [address('v[2]'), address('v[3]')],
      [address('v[3]'), address('v[1]')],
    ]);
  });
});

describe('pointer arithmetic on other element types', () => {
  it('steps over a double, a char and a structure', async () => {
    const run = await exec(
      program(
        `  double w[3] = {1.5, 2.5, 3.5};
  double *dp = w;
  char s[5] = "abcd";
  char *cp = s;
  struct P ps[3];
  ps[1].x = 7;
  ps[2].x = 8;
  struct P *sp = ps;
  printf("%g %d %c %d\\n", *(dp + 1), (int)(&w[2] - dp), *(cp + 2), (int)(&s[3] - cp));
  printf("%d %d %d\\n", (sp + 1)->x, (int)(&ps[2] - sp), sp[2].x);
  sp++;
  dp += 2;
  cp = cp + 3;`,
        'struct P { int x; char c; double d; };'
      )
    );
    expect(run.output).toBe('2.5 2 c 3\n7 2 8\n');
    expect(run.runtime).toEqual([]);
    // A pointer to a structure lands on the structure's first member.
    const arrow = rowNamed(run.model, 'sp').find(
      (cell) => cell.kind === 'value'
    )!.pointerTarget;
    expect(arrow).toMatch(/^main-ps-ps\[1\]-/);
    expect(targetOf(run.model, 'dp')).toBe('w[2]');
    expect(targetOf(run.model, 'cp')).toBe('s[3]');
  });

  it('walks an array through a pointer parameter', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int sum(const int *a, int n) {
  int s = 0;
  for (const int *p = a; p < a + n; p++) {
    s += *p;
  }
  return s;
}
int length(const char *s) {
  const char *e = s;
  while (*e) {
    e++;
  }
  return e - s;
}
int main(void) {
  int v[5] = {1, 2, 3, 4, 5};
  printf("%d %d\\n", sum(v, 5), length("hello"));
  return 0;
}
`)
    ).toBe('15 5\n');
  });
});

describe('a parameter declared as an array', () => {
  it('is the pointer C adjusts it to', async () => {
    const run = await exec(`#include <stdio.h>
int last(int a[], int n) {
  int *end = a + n - 1;
  return *end;
}
int size(double a[10]) {
  return sizeof a;
}
int main(void) {
  int v[3] = {4, 5, 6};
  double w[10];
  printf("%d %d\\n", last(v, 3), size(w));
  return 0;
}
`);
    expect(run.output).toBe('6 4\n');
    expect(run.runtime).toEqual([]);
  });
});

describe('++ and --', () => {
  it('update an element, a member and an object reached through a pointer', async () => {
    const run = await exec(
      program(
        `  int a[3] = {1, 2, 3};
  int i = 0;
  a[i]++;
  ++a[1];
  a[2]--;
  struct S s = {5};
  s.x++;
  struct S *sp = &s;
  sp->x--;
  --sp->x;
  int n = 7;
  int *p = &n;
  (*p)++;
  printf("%d %d %d %d %d %d\\n", a[0], a[1], a[2], s.x, n, i);
  int *q = a;
  int first = *q++;
  printf("%d %d\\n", first, *q);`,
        'struct S { int x; };'
      )
    );
    expect(run.output).toBe('2 3 2 4 8 0\n2 3\n');
    expect(run.runtime).toEqual([]);
    expect(valueOf(run.model, 'a[0]')).toBe('2');
    expect(valueOf(run.model, 'n')).toBe('8');
    expect(targetOf(run.model, 'q')).toBe('a[1]');
    expect(
      run.model.mutations
        .filter((one) => one.target === 'a[1]')
        .map(({ before, after }) => [before, after])
    ).toEqual([['2', '3']]);
  });

  it('wraps at the width of the object', async () => {
    expect(
      await outputOf(
        program(`  unsigned char c = 255;
  c++;
  signed char m = -128;
  m--;
  printf("%d %d\\n", c, m);`)
      )
    ).toBe('0 127\n');
  });
});

describe('pointer arithmetic on an array of arrays', () => {
  it('steps over whole rows', async () => {
    expect(
      await outputOf(
        program(`  int m[3][3] = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
  double d[2][2] = {{1.5, 2.5}, {3.5, 4.5}};
  char c[2][3] = {"ab", "cd"};
  printf("%d %d %d\\n", *(*(m + 1) + 2), **(m + 2), *(m[0] + 1));
  printf("%g %c %d\\n", *(*(d + 1) + 1), *(*(c + 1) + 1),
         (int)(&m[2][0] - &m[0][0]));`)
      )
    ).toBe('6 7 2\n4.5 d 6\n');
  });
});
