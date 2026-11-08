import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { libraryHelp } from '../src/app/libraryHelp';
import { extractModel } from '../src/core/extractModel';
import { extractVariables } from '../src/core/variables';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { formatPrintf } from '../src/interpreter/printf';
import { exec, outputOf, rulesOf, typeOf, valueOf } from './library';

/**
 * `long long` as the eight-byte type C requires.
 *
 * It used to reach the engine as `long`: `sizeof(long long)` was 4, yet the
 * object held values past 32 bits, and `printf("%lld", LLONG_MAX)` printed
 * LLONG_MIN. The rewrite now writes it as one word of its own
 * (`ENGINE_LONG_LONG`), which the engine sizes as eight bytes, and the 64-bit
 * maximums - which a JavaScript number holds only as 2^63 and 2^64 - are read
 * back as the values they stand for.
 */

/** Every state of a run, for checks that look at all of them. */
const statesOf = (code: string): ExecState[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  try {
    const states = [interpreter.startStepExecution(code)];
    while (interpreter.isStepExecutionRunning() && states.length < 5000) {
      states.push(interpreter.stepExecute());
    }
    return states;
  } finally {
    console.log = log;
  }
};

describe('the size of a long long', () => {
  it('is eight bytes, in sizeof, arrays, pointer steps, records and the heap', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdlib.h>
struct Pair { int tag; long long value; };
long long table[3] = {1, 2, 3};
int main(void) {
  long long x = 0;
  unsigned long long u = 0;
  long long *q = &table[2];
  q--;
  *q = 1LL << 40;
  long long *heap = malloc(3 * sizeof(long long));
  heap[2] = 5000000000LL;
  struct Pair pair;
  pair.value = 6000000000LL;
  pair.tag = 7;
  printf("%zu %zu %zu %zu\\n", sizeof(long long), sizeof x, sizeof u,
         sizeof table);
  printf("%d %lld %lld %lld %d\\n", (int)(q - table), table[1], heap[2],
         pair.value, pair.tag);
  free(heap);
  return 0;
}`)
    ).toBe('8 8 8 24\n1 1099511627776 5000000000 6000000000 7\n');
  });

  it('is the same through a typedef and the other spellings of the type', async () => {
    expect(
      await outputOf(`#include <stdio.h>
typedef long long i64;
typedef unsigned long long u64;
int main(void) {
  i64 pair[2] = {1, 2};
  long long int a = 3000000000LL;
  signed long long b = -a;
  long unsigned long c = 4000000000ULL;
  printf("%zu %zu %zu %lld %lld %llu\\n", sizeof(i64), sizeof(u64),
         sizeof pair, a, b, c);
  return 0;
}`)
    ).toBe('8 8 16 3000000000 -3000000000 4000000000\n');
  });

  it('is spelled long long wherever the reader sees a type', () => {
    const code = `#include <stdio.h>
#include <stdlib.h>
typedef long long i64;
struct Total { long long sum; unsigned long long count; };
long long twice(long long v) { return v * 2; }
unsigned long long widen(int n) { return (unsigned long long)n; }
int main(void) {
  long long x = 3;
  unsigned long long u = widen(4);
  long long row[2] = {5, 6};
  long long *p = row;
  long long (*op)(long long) = twice;
  long long y = (long long)x + op(x);
  i64 z = (i64)sizeof(long long);
  struct Total t = {y, u};
  long long *heap = malloc(sizeof(long long));
  *heap = t.sum;
  printf("%lld %llu %lld %lld %lld\\n", y, t.count, *p, z, *heap);
  free(heap);
  return 0;
}`;
    for (const state of statesOf(code)) {
      expect(JSON.stringify(extractModel(state))).not.toMatch(/LongLong/);
      expect(JSON.stringify(extractVariables(state))).not.toMatch(/LongLong/);
    }
    const interpreter = new PlivetCPP14Interpreter();
    expect(JSON.stringify(interpreter.getConstructs(code))).not.toMatch(
      /LongLong/
    );
    expect(JSON.stringify(interpreter.getLints(code))).not.toMatch(/LongLong/);
  });
});

describe('the values of a long long', () => {
  it('wrap at 64 bits, while a long wraps at 32', async () => {
    const run = await exec(`#include <stdio.h>
int main(void) {
  long long x = 3000000000LL;
  x = x + 1;
  unsigned long long u = 0;
  u = u - 1;
  long l = 2147483647;
  l = l + 1;
  long long f = 1;
  for (int k = 1; k <= 20; k++) {
    f = f * k;
  }
  printf("%lld %llu %ld %lld\\n", x, u, l, f);
  return 0;
}`);
    expect(run.output).toBe(
      '3000000001 18446744073709551615 -2147483648 2432902008176640000\n'
    );
    expect(typeOf(run.model, 'x')).toBe('long long');
    expect(typeOf(run.model, 'u')).toBe('unsigned long long');
    expect(valueOf(run.model, 'u')).toBe('18446744073709551615');
    // 20! is past 2^53 and still exact, so nothing is said about it.
    expect(rulesOf(run)).toEqual(['signed-overflow']);
  });

  it('prints and draws the limits exactly', async () => {
    const run = await exec(`#include <stdio.h>
#include <limits.h>
int main(void) {
  long long top = LLONG_MAX;
  long long bottom = LLONG_MIN;
  unsigned long long all = ULLONG_MAX;
  printf("%lld %lld %llu\\n", top, bottom, all);
  printf("%lld %llx %lld\\n", LLONG_MAX, ULLONG_MAX, (long long)ULLONG_MAX);
  return 0;
}`);
    expect(run.output).toBe(
      '9223372036854775807 -9223372036854775808 18446744073709551615\n' +
        '9223372036854775807 ffffffffffffffff -1\n'
    );
    expect(valueOf(run.model, 'top')).toBe('9223372036854775807');
    expect(valueOf(run.model, 'bottom')).toBe('-9223372036854775808');
    expect(valueOf(run.model, 'all')).toBe('18446744073709551615');
    expect(rulesOf(run)).toEqual([]);
  });

  it('overflows past LLONG_MAX to LLONG_MIN, and says so exactly', async () => {
    const run = await exec(`#include <stdio.h>
#include <limits.h>
int main(void) {
  long long m = LLONG_MAX;
  m = m + 1;
  printf("%lld\\n", m);
  return 0;
}`);
    expect(run.output).toBe('-9223372036854775808\n');
    const overflow = run.runtime.find((one) => one.rule === 'signed-overflow');
    expect(overflow?.message).toContain('9223372036854775807 + 1');
    expect(overflow?.message).toContain('-9223372036854775808');
  });

  it('says when a value is past what a number holds exactly', async () => {
    const run = await exec(`#include <stdio.h>
int main(void) {
  long long big = 9007199254740993LL;
  long long sum = 9007199254740992LL + 1;
  unsigned long long minus = (unsigned long long)-5;
  printf("%lld %lld %llu\\n", big, sum, minus);
  return 0;
}`);
    const inexact = run.runtime.filter((one) => one.rule === 'inexact-integer');
    expect(inexact.map((one) => one.line)).toEqual([3, 4, 5]);
    expect(inexact[0].message).toContain('2^53');
  });

  it('cast, convert and pass through functions at 64 bits', async () => {
    expect(
      await outputOf(`#include <stdio.h>
long long twice(long long v) { return v * 2; }
int main(void) {
  int n = 2000000000;
  long long w = (long long)n * 3;
  long long minus = (long long)(-1);
  int narrowed = (int)w;
  long long scanned = 0;
  sscanf("123456789012", "%lld", &scanned);
  printf("%lld %lld %lld %d %lld\\n", w, twice(w), minus, narrowed,
         scanned + 1);
  return 0;
}`)
    ).toBe('6000000000 12000000000 -1 1705032704 123456789013\n');
  });

  it('pass through ... as long long, constants included', async () => {
    const run = await exec(`#include <stdio.h>
#include <stdarg.h>
long long total(int count, ...) {
  va_list ap;
  va_start(ap, count);
  long long sum = 0;
  for (int i = 0; i < count; i++) {
    sum += va_arg(ap, long long);
  }
  va_end(ap);
  return sum;
}
int main(void) {
  printf("%lld\\n", total(3, 5000000000LL, 1LL, 2LL));
  return 0;
}`);
    expect(run.output).toBe('5000000003\n');
    expect(rulesOf(run)).toEqual([]);
  });

  it('are integers to the format lint', () => {
    const lints = new PlivetCPP14Interpreter().getLints(`#include <stdio.h>
int main(void) {
  long long x = 1;
  printf("%f %lld\\n", x, x);
  return 0;
}
`);
    expect(lints.map((one) => [one.rule, one.line])).toEqual([
      ['format-arguments', 4],
    ]);
    expect(lints[0].message).not.toMatch(/LongLong/);
  });
});

describe('the 64-bit types of <stdint.h>', () => {
  it('are long long, with their limits', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdint.h>
int main(void) {
  int64_t low = INT64_MIN;
  uint64_t none = 0;
  none--;
  intmax_t widest = INTMAX_MAX;
  printf("%zu %zu %zu %zu\\n", sizeof(int64_t), sizeof(uint64_t),
         sizeof(intmax_t), sizeof(uintmax_t));
  printf("%lld %llu %jd %llu\\n", low, none, widest, UINT64_MAX);
  return 0;
}`)
    ).toBe(
      '8 8 8 8\n' +
        '-9223372036854775808 18446744073709551615 9223372036854775807 ' +
        '18446744073709551615\n'
    );
    expect(libraryHelp('int64_t')).toMatchObject({
      header: 'stdint.h',
      signature: 'typedef long long int64_t',
    });
    expect(libraryHelp('UINT64_MAX')?.header).toBe('stdint.h');
  });
});

describe('printf with a 64-bit maximum held in a number', () => {
  it('reads 2^63 and 2^64 as the maximums they were rounded from', () => {
    const format = (spec: string, value: number | string): string =>
      formatPrintf(spec, [{ kind: 'int', value }]).text;
    expect(format('%lld', 2 ** 63)).toBe('9223372036854775807');
    expect(format('%llu', 2 ** 63)).toBe('9223372036854775808');
    expect(format('%llu', 2 ** 64)).toBe('18446744073709551615');
    expect(format('%lld', 2 ** 64)).toBe('-1');
    // An exact value the caller spelled out is its own.
    expect(format('%lld', '9223372036854775808')).toBe('-9223372036854775808');
  });
});
