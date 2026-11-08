import { libraryHelp } from '../src/app/libraryHelp';
import { exec, outputOf, rulesOf, valueOf } from './library';

/**
 * `<stdlib.h>`: `calloc` on the canvas, the string conversions to the letter
 * of C11 7.22.1, the integer arithmetic, `div`'s structure, the generator,
 * and `exit` with its status.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <limits.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

describe('calloc', () => {
  it('zeroes the block it allocates, where malloc leaves it uninitialized', async () => {
    const run = await exec(
      program(`  int *m = malloc(2 * sizeof(int));
  int *c = calloc(3, sizeof(int));
  double *d = calloc(2, sizeof(double));
  printf("%d %d %.1f\\n", c[0], c[2], d[1]);`)
    );
    expect(run.output).toBe('0 0 0.0\n');
    expect(valueOf(run.model, 'Heap:20000')).toBe('uninitialized');
    // c's three ints from 20008, then d's two doubles from 20020.
    expect(valueOf(run.model, 'Heap:20008')).toBe('0');
    expect(valueOf(run.model, 'Heap:20016')).toBe('0');
    expect(valueOf(run.model, 'Heap:20028')).toBe('0');
    expect(run.runtime).toEqual([]);
  });
});

describe('the string conversions', () => {
  it('strtol skips white space, takes a sign, and stores where it stopped', async () => {
    const run = await exec(
      program(`  char *end;
  long v = strtol("  -42abc", &end, 10);
  printf("%ld [%s]\\n", v, end);`)
    );
    expect(run.output).toBe('-42 [abc]\n');
    expect(valueOf(run.model, 'end')).toMatch(/^0x/);
  });

  it('strtol reads 0x and 0 prefixes for base 0, and any base up to 36', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%ld %ld %ld %ld %ld\\n", strtol("0x1F", NULL, 0), strtol("017", NULL, 0), strtol("17", NULL, 0), strtol("ff", NULL, 16), strtol("zz", NULL, 36));`
        )
      )
    ).toBe('31 15 17 255 1295\n');
  });

  it('strtol with no digits converts nothing and points the end back at the start', async () => {
    expect(
      await outputOf(
        program(`  const char *text = "  x1";
  char *end;
  long v = strtol(text, &end, 10);
  printf("%ld %d\\n", v, end == text);`)
      )
    ).toBe('0 1\n');
  });

  it('strtol clamps on overflow and sets errno to ERANGE', async () => {
    const run = await exec(
      program(`  errno = 0;
  long big = strtol("99999999999", NULL, 10);
  printf("%d %d\\n", big == LONG_MAX, errno == ERANGE);
  errno = 0;
  long small = strtol("-99999999999", NULL, 10);
  printf("%d %d\\n", small == LONG_MIN, errno == ERANGE);`)
    );
    expect(run.output).toBe('1 1\n1 1\n');
    // errno is an object the program names, so it is on the canvas.
    expect(valueOf(run.model, 'errno')).toBe('34');
  });

  it('strtoul negates in the unsigned type; strtoll and strtoull reach 64 bits', async () => {
    expect(
      await outputOf(
        program(`  printf("%d %d\\n", strtoul("-1", NULL, 10) == ULONG_MAX, strtoull("123", NULL, 10) == 123);
  printf("%d\\n", strtoll("5000000000", NULL, 10) / 1000000000 == 5);`)
      )
    ).toBe('1 1\n1\n');
  });

  it('strtod reads decimals, exponents, hexadecimal, infinity and NaN', async () => {
    const run = await exec(
      program(`  char *end;
  double a = strtod(" 2.5e3xyz", &end);
  printf("%.1f [%s] %.3f %d %d\\n", a, end, strtod("0x1.8p1", NULL), strtod("-inf", NULL) < 0, strtod("nan", NULL) != strtod("nan", NULL));`)
    );
    expect(run.output).toBe('2500.0 [xyz] 3.000 1 1\n');
  });

  it('strtod sets ERANGE on overflow', async () => {
    expect(
      await outputOf(
        program(`  errno = 0;
  double huge = strtod("1e999", NULL);
  printf("%d %d\\n", huge > 1e308, errno == ERANGE);`)
      )
    ).toBe('1 1\n');
  });

  it('atoi, atol, atoll and atof convert without reporting', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%d %d %ld %lld %.2f\\n", atoi("  -17 apples"), atoi("x"), atol("+90"), atoll("12"), atof("3.25 m"));`
        )
      )
    ).toBe('-17 0 90 12 3.25\n');
  });

  it('integer results divide as integers', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%d %d %ld %lld\\n", atoi("7") / 2, abs(-7) / 2, labs(-9L) / 2, llabs(-5) / 2);`
        )
      )
    ).toBe('3 3 4 2\n');
  });
});

describe('div and ldiv', () => {
  it('return the quotient and the remainder as a structure', async () => {
    const run = await exec(
      program(`  div_t r = div(17, 5);
  ldiv_t l = ldiv(-7L, 2L);
  printf("%d %d %ld %ld %d\\n", r.quot, r.rem, l.quot, l.rem, div(9, 4).rem);`)
    );
    expect(run.output).toBe('3 2 -3 -1 1\n');
    expect(valueOf(run.model, 'quot')).toBe('3');
    expect(valueOf(run.model, 'rem')).toBe('2');
  });

  it('refuse a division by zero', async () => {
    const run = await exec(program(`  div_t r = div(1, 0);`));
    expect(rulesOf(run)).toEqual(['division-by-zero']);
  });
});

describe('rand and srand', () => {
  it('is the C standard sample generator, seeded with 1 until srand says otherwise', async () => {
    expect(
      await outputOf(
        program(`  printf("%d %d %d\\n", rand(), rand(), rand());
  srand(1);
  printf("%d\\n", rand());
  srand(42);
  int a = rand();
  srand(42);
  printf("%d %d\\n", a == rand(), RAND_MAX);`)
      )
    ).toBe('16838 5758 10113\n16838\n1 32767\n');
  });

  it('stays within 0 and RAND_MAX', async () => {
    expect(
      await outputOf(
        program(`  int bad = 0;
  srand(7);
  for (int i = 0; i < 200; i++) {
    int r = rand();
    if (r < 0 || r > RAND_MAX) bad++;
  }
  printf("%d\\n", bad);`)
      )
    ).toBe('0\n');
  });
});

describe('exit', () => {
  it('shows a failing status on the console, and ends the program from any depth', async () => {
    const run = await exec(
      program(
        `  printf("start\\n");
  fail();
  printf("not reached\\n");`,
        `void fail(void) { exit(EXIT_FAILURE); }`
      )
    );
    expect(run.output).toBe(
      'start\n[exit] the program ended with status 1 (EXIT_FAILURE)\n'
    );
  });

  it('says nothing about EXIT_SUCCESS', async () => {
    const run = await exec(
      program(`  printf("done\\n");
  exit(EXIT_SUCCESS);`)
    );
    expect(run.output).toBe('done\n');
  });
});

it("lets a program's own function of the same name win", async () => {
  expect(
    await outputOf(
      program(
        `  printf("%d %d\\n", div(10, 3), strlen("abc"));`,
        `int div(int a, int b) { return a * b; }
int strlen(const char *s) { return 99; }`
      )
    )
  ).toBe('30 99\n');
});

it('documents every <stdlib.h> addition', () => {
  for (const name of [
    'calloc',
    'strtol',
    'strtoul',
    'strtoll',
    'strtoull',
    'strtod',
    'atof',
    'atol',
    'atoll',
    'labs',
    'llabs',
    'div',
    'ldiv',
    'srand',
    'RAND_MAX',
    'EXIT_SUCCESS',
    'EXIT_FAILURE',
  ]) {
    expect(libraryHelp(name)).toMatchObject({ header: 'stdlib.h' });
  }
});
