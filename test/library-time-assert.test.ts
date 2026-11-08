import { libraryHelp } from '../src/app/libraryHelp';
import { exec, outputOf, rulesOf, typeOf, valueOf } from './library';

/**
 * L10 and L11: `time`, `clock`, `difftime`, `assert`, and `errno` as an
 * object of the program's own.
 */

describe('<time.h>', () => {
  it('time returns the calendar time and stores it through its argument', async () => {
    const before = Math.floor(Date.now() / 1000);
    const run = await exec(`#include <stdio.h>
#include <time.h>
int main(void) {
  time_t t;
  time_t now = time(&t);
  printf("%ld %d\\n", now, now == t && time(NULL) >= now);
  return 0;
}`);
    const after = Math.floor(Date.now() / 1000);
    const [seconds, same] = run.output.trim().split(' ').map(Number);
    expect(seconds).toBeGreaterThanOrEqual(before);
    expect(seconds).toBeLessThanOrEqual(after);
    expect(same).toBe(1);
    expect(typeOf(run.model, 't')).toBe('time_t');
    expect(valueOf(run.model, 't')).toBe(String(seconds));
  });

  it('clock counts up in CLOCKS_PER_SEC units and difftime subtracts', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <time.h>
int main(void) {
  clock_t start = clock();
  long sum = 0;
  for (int i = 0; i < 50; i++) sum += i;
  clock_t end = clock();
  printf("%d %d %.1f\\n", end >= start, CLOCKS_PER_SEC, difftime((time_t)100, (time_t)40));
  return 0;
}`)
    ).toBe('1 1000000 60.0\n');
  });

  it('seeds rand from the clock', async () => {
    const run = await exec(`#include <stdlib.h>
#include <time.h>
int main(void) {
  srand(time(NULL));
  return rand() % 6;
}`);
    expect(run.runtime).toEqual([]);
  });
});

describe('assert', () => {
  const failing = `#include <stdio.h>
#include <assert.h>
int check(int x) {
  assert(x > 0 && x < 10);
  return x;
}
int main(void) {
  check(5);
  printf("first passed\\n");
  check(12);
  printf("not reached\\n");
  return 0;
}`;

  it('does nothing when the condition holds, and stops with the standard message when not', async () => {
    const run = await exec(failing);
    expect(run.output).toBe(
      'first passed\nAssertion failed: x > 0 && x < 10, file main.c, line 4\n'
    );
  });

  it('puts a fatal diagnostic on the line', async () => {
    const run = await exec(failing);
    expect(rulesOf(run)).toEqual(['assertion-failed']);
    expect(run.runtime[0]).toMatchObject({
      severity: 'error',
      fatal: true,
      line: 4,
    });
    expect(run.runtime[0].message).toContain('x > 0 && x < 10');
  });

  it('quotes the condition as written, macros and all', async () => {
    const run = await exec(`#include <assert.h>
#define LIMIT 3
int main(void) {
  int n = 4;
  assert(n <= LIMIT);
  return 0;
}`);
    expect(run.output).toBe(
      'Assertion failed: n <= LIMIT, file main.c, line 5\n'
    );
  });
});

describe('errno', () => {
  it('is a modifiable int object among the globals of a program that names it', async () => {
    const run = await exec(`#include <stdio.h>
#include <errno.h>
#include <string.h>
int main(void) {
  printf("%d\\n", errno);
  errno = ERANGE;
  printf("%s\\n", strerror(errno));
  return 0;
}`);
    expect(run.output).toBe('0\nNumerical result out of range\n');
    expect(typeOf(run.model, 'errno')).toBe('int');
    expect(valueOf(run.model, 'errno')).toBe('34');
    expect(run.model.stacks[0].name).toBe('GLOBAL');
  });

  it('stays off the canvas of a program that does not name it', async () => {
    const run = await exec(`#include <stdlib.h>
int main(void) {
  long n = strtol("99999999999", NULL, 10);
  return 0;
}`);
    expect(() => valueOf(run.model, 'errno')).toThrow();
  });

  it('defines the error numbers and the exit statuses', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <errno.h>
#include <stdlib.h>
int main(void) {
  printf("%d %d %d %d %d %d\\n", EDOM, ERANGE, EINVAL, ENOENT, EXIT_SUCCESS, EXIT_FAILURE);
  return 0;
}`)
    ).toBe('33 34 22 2 0 1\n');
  });
});

it('documents time, clock, difftime, assert and errno', () => {
  expect(libraryHelp('time')).toMatchObject({ header: 'time.h' });
  expect(libraryHelp('clock')).toMatchObject({ header: 'time.h' });
  expect(libraryHelp('difftime')).toMatchObject({ header: 'time.h' });
  expect(libraryHelp('CLOCKS_PER_SEC')).toMatchObject({ header: 'time.h' });
  expect(libraryHelp('assert')).toMatchObject({ header: 'assert.h' });
  expect(libraryHelp('errno')).toMatchObject({
    header: 'errno.h',
    kind: 'object',
  });
  for (const name of ['time_t', 'clock_t']) {
    expect(libraryHelp(name)).toMatchObject({ header: 'time.h', kind: 'type' });
  }
});
