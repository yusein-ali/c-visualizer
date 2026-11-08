import { libraryHelp } from '../src/app/libraryHelp';
import { LIBRARY_CONSTANTS } from '../src/interpreter/library/constants';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { exec, outputOf } from './library';

/**
 * `<limits.h>`, `<float.h>` and `<stdbool.h>`'s `true` and `false`: defined,
 * with the values this engine's data model gives them, usable as `int`
 * constants (they wrap and divide as one), and not flagged by the
 * undeclared-identifier rule.
 */

const program = (body: string): string => `#include <stdio.h>
#include <limits.h>
#include <float.h>
#include <stdbool.h>
int main(void) {
${body}
  return 0;
}`;

describe('<limits.h>', () => {
  it('defines the integer limits', async () => {
    expect(
      await outputOf(
        program(`  printf("%d %d %d %d %d %d\\n", CHAR_BIT, SCHAR_MIN, SCHAR_MAX, UCHAR_MAX, CHAR_MIN, CHAR_MAX);
  printf("%d %d %d\\n", SHRT_MIN, SHRT_MAX, USHRT_MAX);
  printf("%d %d %u\\n", INT_MIN, INT_MAX, UINT_MAX);
  printf("%ld %ld %lu\\n", LONG_MIN, LONG_MAX, ULONG_MAX);`)
      )
    ).toBe(
      '8 -128 127 255 -128 127\n' +
        '-32768 32767 65535\n' +
        '-2147483648 2147483647 4294967295\n' +
        '-2147483648 2147483647 4294967295\n'
    );
  });

  it('keeps INT_MAX an int: one more wraps, and it divides as an integer', async () => {
    expect(
      await outputOf(
        program(`  int big = INT_MAX;
  big = big + 1;
  printf("%d %d %d\\n", big == INT_MIN, INT_MAX / 2, -INT_MAX);`)
      )
    ).toBe('1 1073741823 -2147483647\n');
  });

  it('gives long long the 64-bit limits C requires', () => {
    expect(LIBRARY_CONSTANTS.LLONG_MIN.value).toBe(-(2 ** 63));
    expect(LIBRARY_CONSTANTS.LLONG_MAX.value).toBe(2 ** 63);
    expect(LIBRARY_CONSTANTS.ULLONG_MAX.value).toBe(2 ** 64);
  });
});

describe('<float.h>', () => {
  it('defines the floating limits', async () => {
    expect(
      await outputOf(
        program(`  printf("%g %g %g %d\\n", FLT_MIN, FLT_MAX, FLT_EPSILON, FLT_DIG);
  printf("%g %g %g %d\\n", DBL_MIN, DBL_MAX, DBL_EPSILON, DBL_DIG);
  printf("%d\\n", 1.0 + DBL_EPSILON > 1.0);`)
      )
    ).toBe(
      '1.17549e-38 3.40282e+38 1.19209e-07 6\n' +
        '2.22507e-308 1.79769e+308 2.22045e-16 15\n' +
        '1\n'
    );
  });
});

describe('true and false', () => {
  it('are the int constants 1 and 0', async () => {
    const run = await exec(
      program(`  bool done = false;
  int count = true + true;
  if (true) {
    done = true;
  }
  printf("%d %d %d %d\\n", done, count, true, false);`)
    );
    expect(run.output).toBe('1 2 1 0\n');
    expect(run.response.errors).toEqual([]);
  });

  it('yield to a program that defines them itself', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#undef true
#define true 7
int main(void) {
  printf("%d\\n", true);
  return 0;
}`)
    ).toBe('7\n');
  });
});

it('raises no undeclared-identifier lint for the new macros', () => {
  const interpreter = new PlivetCPP14Interpreter();
  const code =
    program(`  int x = INT_MAX + CHAR_BIT + EXIT_FAILURE + ERANGE + RAND_MAX;
  double y = DBL_EPSILON + NAN + INFINITY + HUGE_VAL;
  long z = CLOCKS_PER_SEC;
  bool b = true;
  printf("%d %f %ld %d\\n", x, y, z, b);`);
  const log = console.log;
  console.log = () => undefined;
  try {
    const lints = interpreter.getLints(code);
    expect(
      lints.filter((lint) => lint.rule === 'undeclared-identifier')
    ).toEqual([]);
  } finally {
    console.log = log;
  }
});

it('documents every constant with its header and value', () => {
  for (const [name, constant] of Object.entries(LIBRARY_CONSTANTS)) {
    expect(libraryHelp(name)).toEqual({
      header: constant.header,
      kind: 'macro',
      signature: `#define ${name} ${constant.spelling}`,
      description: constant.description,
    });
  }
  expect(libraryHelp('true')).toMatchObject({ header: 'stdbool.h' });
  expect(libraryHelp('false')).toMatchObject({ header: 'stdbool.h' });
});
