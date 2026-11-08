import { libraryHelp } from '../src/app/libraryHelp';
import { exec, outputOf } from './library';

/**
 * `<math.h>`: the functions L15 adds, the classification macros, the special
 * values, `errno` on a domain or range error, and the upstream answers that
 * were wrong.
 */

const program = (body: string): string => `#include <stdio.h>
#include <math.h>
#include <errno.h>
int main(void) {
${body}
  return 0;
}`;

describe('<math.h>', () => {
  it('computes the functions a course meets', async () => {
    expect(
      await outputOf(
        program(`  printf("%.4f %.1f %.1f %.1f\\n", atan2(1.0, -1.0), log2(1024.0), trunc(-2.7), nearbyint(2.5));
  printf("%.1f %.1f %.1f %.1f\\n", copysign(3.0, -0.0), fma(2.0, 3.0, 1.0), remainder(7.0, 2.0), ldexp(0.75, 4));
  printf("%.4f %.4f %.4f\\n", asinh(1.0), acosh(2.0), atanh(0.5));
  printf("%.0f %.4f %.0f %.4f\\n", exp2(10.0), expm1(0.0001), log10(1000.0), log1p(0.0001));`)
      )
    ).toBe(
      '2.3562 10.0 -2.0 2.0\n' +
        '-3.0 7.0 -1.0 12.0\n' +
        '0.8814 1.3170 0.5493\n' +
        '1024 0.0001 3 0.0001\n'
    );
  });

  it('splits a double with modf and frexp through their pointers', async () => {
    const run = await exec(
      program(`  double whole;
  double fraction = modf(-3.75, &whole);
  int exponent;
  double mantissa = frexp(48.0, &exponent);
  printf("%.2f %.1f %.3f %d\\n", fraction, whole, mantissa, exponent);`)
    );
    expect(run.output).toBe('-0.75 -3.0 0.750 6\n');
    expect(run.runtime).toEqual([]);
  });

  it('negates a double, a literal and INFINITY', async () => {
    expect(
      await outputOf(
        program(`  double d = 1.5;
  double e = -d;
  printf("%.1f %.1f %d %d\\n", e, -2.5, -INFINITY < 0, +d == 1.5);`)
      )
    ).toBe('-1.5 -2.5 1 1\n');
  });

  it('classifies NAN, INFINITY and HUGE_VAL', async () => {
    expect(
      await outputOf(
        program(`  double nan = NAN;
  printf("%d %d %d %d\\n", isnan(nan), nan == nan, isinf(INFINITY), isinf(-HUGE_VAL));
  printf("%d %d %d %d\\n", isfinite(1.0), isfinite(INFINITY), signbit(-0.0) != 0, signbit(2.0));`)
      )
    ).toBe('1 0 1 -1\n1 0 1 0\n');
  });

  it('divides by a floating zero as IEEE does, and still refuses an integer zero', async () => {
    expect(
      await outputOf(
        program(`  double zero = 0.0;
  printf("%d %d %d\\n", isnan(0.0 / 0.0), isinf(1.0 / zero), 1.0 / zero == INFINITY);`)
      )
    ).toBe('1 1 1\n');
    const run = await exec(
      program(`  int zero = 0;
  printf("%d\\n", 1 / zero);`)
    );
    expect(run.runtime.map((one) => one.rule)).toEqual(['division-by-zero']);
  });

  it('sets errno to EDOM and ERANGE as glibc does', async () => {
    expect(
      await outputOf(
        program(`  errno = 0;
  double a = sqrt(-1.0);
  printf("%d %d\\n", isnan(a), errno == EDOM);
  errno = 0;
  double b = log(0.0);
  printf("%d %d\\n", isinf(b), errno == ERANGE);
  errno = 0;
  double c = sqrt(4.0);
  printf("%.0f %d\\n", c, errno);`)
      )
    ).toBe('1 1\n-1 1\n2 0\n');
  });

  it('rounds and compares the way C does where upstream did not', async () => {
    expect(
      await outputOf(
        program(`  printf("%.0f %.0f %.0f %.1f\\n", round(-2.5), round(2.5), rint(3.5), fdim(-5.0, 3.0));
  printf("%.1f %.1f\\n", fmax(NAN, 1.0), fmin(2.0, NAN));`)
      )
    ).toBe('-3 3 4 0.0\n1.0 2.0\n');
  });

  it('documents every function, the four upstream left out included', () => {
    for (const name of [
      'atan2',
      'log2',
      'trunc',
      'nearbyint',
      'modf',
      'frexp',
      'ldexp',
      'copysign',
      'fma',
      'remainder',
      'asinh',
      'acosh',
      'atanh',
      'isnan',
      'isinf',
      'isfinite',
      'signbit',
      'exp2',
      'expm1',
      'log10',
      'log1p',
      'NAN',
      'INFINITY',
      'HUGE_VAL',
    ]) {
      expect(libraryHelp(name)).toMatchObject({ header: 'math.h' });
    }
  });
});
