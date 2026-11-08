import { libraryHelp } from '../src/app/libraryHelp';
import { Server, StepModel } from '../src/core';
import { extractModel } from '../src/core/extractModel';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { exec, outputOf, rulesOf, targetOf, valueOf } from './library';

/**
 * `qsort` and `bsearch` (L12): the comparator is the program's own function,
 * called through the pointer as interpreted code, and the sort's moves are
 * ordinary writes.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int cmpInt(const void *a, const void *b) {
  return *(const int *)a - *(const int *)b;
}
${globals}
int main(void) {
${body}
  return 0;
}`;

/** Every step of a run, as the canvas would be given it. */
const stepsOf = (code: string): StepModel[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const steps: StepModel[] = [];
  try {
    let state = interpreter.startStepExecution(code);
    let count = 0;
    while (interpreter.isStepExecutionRunning() && count < 2000) {
      steps.push(extractModel(state));
      state = interpreter.stepExecute();
      count += 1;
    }
    steps.push(extractModel(state));
  } finally {
    console.log = log;
  }
  return steps;
};

describe('qsort', () => {
  it('sorts ints, and records the array before and after', async () => {
    const run = await exec(
      program(`  int v[5] = {5, 3, 4, 1, 2};
  qsort(v, 5, sizeof(int), cmpInt);
  printf("%d %d %d %d %d\\n", v[0], v[1], v[2], v[3], v[4]);`)
    );
    expect(run.output).toBe('1 2 3 4 5\n');
    expect(run.runtime).toEqual([]);
    expect(run.model.mutations.filter((one) => one.target === 'v')).toEqual([
      {
        target: 'v',
        frame: 'main',
        before: '{5, 3, 4, 1, 2}',
        after: '{1, 2, 3, 4, 5}',
        line: 10,
      },
    ]);
  });

  it('sorts doubles and characters', async () => {
    expect(
      await outputOf(
        program(
          `  double d[4] = {2.5, -1.0, 0.5, 2.0};
  qsort(d, 4, sizeof d[0], cmpDouble);
  char s[] = "qsort";
  qsort(s, strlen(s), 1, cmpChar);
  printf("%.1f %.1f %.1f %.1f %s\\n", d[0], d[1], d[2], d[3], s);`,
          `int cmpDouble(const void *a, const void *b) {
  double l = *(const double *)a;
  double r = *(const double *)b;
  return (l > r) - (l < r);
}
int cmpChar(const void *a, const void *b) {
  return *(const char *)a - *(const char *)b;
}`
        )
      )
    ).toBe('-1.0 0.5 2.0 2.5 oqrst\n');
  });

  it('sorts structures member by member, and stably', async () => {
    const run = await exec(
      program(
        `  struct P ps[4] = {{3, 1}, {1, 2}, {3, 3}, {2, 4}};
  qsort(ps, 4, sizeof(struct P), byKey);
  for (int i = 0; i < 4; i++) {
    printf("%d/%d ", ps[i].key, ps[i].order);
  }
  printf("\\n");`,
        `struct P { int key; int order; };
int byKey(const void *a, const void *b) {
  const struct P *l = a;
  const struct P *r = b;
  return l->key - r->key;
}`
      )
    );
    expect(run.output).toBe('1/2 2/4 3/1 3/3 \n');
    expect(run.runtime).toEqual([]);
  });

  it('sorts pointers by what they point at', async () => {
    expect(
      await outputOf(
        program(
          `  int a = 30, b = 10, c = 20;
  int *ps[3];
  ps[0] = &a;
  ps[1] = &b;
  ps[2] = &c;
  qsort(ps, 3, sizeof(int *), byTarget);
  printf("%d %d %d\\n", *ps[0], *ps[1], *ps[2]);`,
          `int byTarget(const void *x, const void *y) {
  int l = **(int * const *)x;
  int r = **(int * const *)y;
  return l - r;
}`
        )
      )
    ).toBe('10 20 30\n');
  });

  it('steps into the comparator, whose pointers point into the array', () => {
    const steps = stepsOf(
      program(`  int v[3] = {3, 1, 2};
  qsort(v, 3, sizeof v[0], cmpInt);
  printf("%d %d %d\\n", v[0], v[1], v[2]);`)
    );
    const inside = steps.filter(
      (step) =>
        step.codeRange !== null &&
        step.codeRange.begin.y === 5 &&
        step.frames.some((frame) => frame.name === 'cmpInt')
    );
    // Three elements, inserted by adjacent swaps: 3 comparisons.
    expect(inside.length).toBe(3);
    const first = inside[0];
    const frame = first.frames.find((one) => one.name === 'cmpInt')!;
    expect(frame.calledFrom).toBe(10);
    expect(frame.arguments.map((one) => one.name)).toEqual(['a', 'b']);
    expect(targetOf(first, 'a')).toBe('v[0]');
    expect(targetOf(first, 'b')).toBe('v[1]');
    // The array is drawn mid-sort: after the first swap, 1 is in front.
    const second = inside[1];
    expect(valueOf(second, 'v[0]')).toBe('1');
    expect(valueOf(second, 'v[1]')).toBe('3');
    expect(steps[steps.length - 1].stacks.length).toBeGreaterThan(0);
  });

  it('stops in the comparator on Step events through the server', async () => {
    const source = program(`  int v[3] = {2, 1, 3};
  qsort(v, 3, sizeof v[0], cmpInt);`);
    const server = new Server();
    const log = console.log;
    console.log = () => undefined;
    const lines: number[] = [];
    try {
      let response = await server.send({
        controlEvent: 'Start',
        sourcecode: source,
      });
      for (let i = 0; i < 50 && response.debugState !== 'EOF'; i += 1) {
        response = await server.send({
          controlEvent: 'Step',
          sourcecode: source,
        });
        if (response.model.frames.some((frame) => frame.name === 'cmpInt')) {
          lines.push(response.model.codeRange?.begin.y ?? 0);
        }
      }
      expect(response.debugState).toBe('EOF');
    } finally {
      console.log = log;
    }
    // Two comparisons, each a stop on the comparator's return statement.
    expect(lines).toEqual([5, 5]);
  });

  it('refuses an element size that is not the elements’ size', async () => {
    const run = await exec(
      program(`  int v[3] = {3, 1, 2};
  qsort(v, 3, 8, cmpInt);`)
    );
    expect(rulesOf(run)).toEqual(['element-size']);
  });

  it('refuses a count past the end of the array', async () => {
    const run = await exec(
      program(`  int v[3] = {3, 1, 2};
  qsort(v, 4, sizeof(int), cmpInt);`)
    );
    expect(rulesOf(run)).toEqual(['buffer-overflow']);
  });

  it('refuses a null comparison function', async () => {
    const run = await exec(
      program(`  int v[3] = {3, 1, 2};
  qsort(v, 3, sizeof(int), NULL);`)
    );
    expect(rulesOf(run)).toEqual(['invalid-function-pointer']);
  });
});

describe('bsearch', () => {
  it('finds an element, or answers with a null pointer', async () => {
    expect(
      await outputOf(
        program(`  int v[6] = {1, 3, 5, 7, 9, 11};
  int key = 7;
  int *found = bsearch(&key, v, 6, sizeof v[0], cmpInt);
  key = 4;
  int *missing = bsearch(&key, v, 6, sizeof v[0], cmpInt);
  printf("%d %d %d\\n", *found, found == &v[3], missing == NULL);`)
      )
    ).toBe('7 1 1\n');
  });

  it('calls the comparator with the key first', () => {
    const steps = stepsOf(
      program(`  int v[3] = {1, 2, 3};
  int key = 3;
  int *found = bsearch(&key, v, 3, sizeof(int), cmpInt);`)
    );
    const inside = steps.filter(
      (step) =>
        step.codeRange !== null &&
        step.codeRange.begin.y === 5 &&
        step.frames.some((frame) => frame.name === 'cmpInt')
    );
    expect(inside.length).toBe(2);
    expect(targetOf(inside[0], 'a')).toBe('key');
    expect(targetOf(inside[0], 'b')).toBe('v[1]');
    expect(targetOf(inside[1], 'b')).toBe('v[2]');
  });
});

it('documents qsort and bsearch', () => {
  for (const name of ['qsort', 'bsearch']) {
    expect(libraryHelp(name)).toMatchObject({ header: 'stdlib.h' });
  }
});
