import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { extractModel } from '../src/core/extractModel';
import { FrameModel, StepModel } from '../src/core';

/**
 * The Call stack's frames: every call is one, however it reaches its
 * function; its count is of the calls of that function on the stack; and
 * its arguments read as the Variables view reads the same values.
 */

const stepsOf = (code: string): StepModel[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const steps: StepModel[] = [];
  try {
    let state = interpreter.startStepExecution(code);
    let count = 0;
    while (interpreter.isStepExecutionRunning() && count < 500) {
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

/** The first step on a line, and every one. */
const on = (steps: StepModel[], line: number): StepModel[] =>
  steps.filter(
    (step) => step.codeRange !== null && step.codeRange.begin.y === line
  );

const names = (frames: FrameModel[]): string[] =>
  frames.map((frame) => frame.name);

const argumentsOf = (frame: FrameModel): string =>
  frame.arguments.map(({ name, value }) => `${name} = ${value}`).join(', ');

/** What the Variables view says a frame's object holds. */
const shown = (step: StepModel, frame: string, name: string): string =>
  step.variables.find(
    (variable) => variable.frame === frame && variable.name === name
  )!.value;

describe('a call through a function pointer', () => {
  it('is a frame, named as its function, as a direct call is', () => {
    const steps = stepsOf(`#include <stdio.h>
int sum(int a, int b)
{
  int s = a + b;
  return s;
}
int main(void)
{
  int (*p)(int, int) = sum;
  int x = sum(1, 2);
  int y = p(3, 4);
  printf("%d %d\\n", x, y);
  return 0;
}`);
    const inside = on(steps, 4);
    expect(inside).toHaveLength(2);
    for (const step of inside) {
      expect(names(step.frames)).toEqual(['main', 'sum']);
    }
    expect(argumentsOf(inside[1].frames[1])).toBe('a = 3, b = 4');
    expect(inside[1].frames[1].calledFrom).toBe(11);
  });

  it('is a frame through a parameter and through a structure member', () => {
    const steps = stepsOf(`#include <stdio.h>
struct shelf { int books; };
struct row { int (*run)(struct shelf *); };
int count(struct shelf *s) { return s->books; }
int twice(int n) { return 2 * n; }
int combine(int (*f)(int), const int *p) { return f(*p); }
int main(void)
{
  struct shelf shelf = {3};
  struct row r = {count};
  struct row *row = &r;
  int x = 5;
  int a = combine(twice, &x);
  int b = row->run(&shelf);
  printf("%d %d\\n", a, b);
  return 0;
}`);
    expect(names(on(steps, 5)[0].frames)).toEqual(['main', 'combine', 'twice']);
    expect(names(on(steps, 4)[0].frames)).toEqual(['main', 'count']);
    expect(steps[steps.length - 1].frames).toEqual([]);
  });
});

describe('the count of active invocations', () => {
  it('counts the calls on the stack, not the calls so far', () => {
    const steps = stepsOf(`#include <stdio.h>
int twice(int a)
{
  int t = 2 * a;
  return t;
}
int depth(int n)
{
  if (n == 0) {
    return 0;
  }
  return 1 + depth(n - 1);
}
int main(void)
{
  int x = twice(1);
  int y = twice(2);
  printf("%d %d %d\\n", x, y, depth(2));
  return 0;
}`);
    expect(on(steps, 4).map((step) => step.frames[1].timesEntered)).toEqual([
      1, 1,
    ]);
    // The base case runs three calls deep.
    const base = on(steps, 10)[0];
    expect(base.frames.map((frame) => frame.timesEntered)).toEqual([
      1, 1, 2, 3,
    ]);
  });
});

describe("a frame's arguments", () => {
  it('read as the Variables view reads the same values', () => {
    const steps = stepsOf(`#include <stdio.h>
int twice(int a)
{
  return 2 * a;
}
int apply(const int *p, int (*f)(int))
{
  return f(*p);
}
void show(int *p, char *s, double *d, char c)
{
  printf("%d %s %.1f %c\\n", *p, s, *d, c);
}
int main(void)
{
  int x = 21;
  char word[4] = "abc";
  double y = 2.5;
  printf("%d\\n", apply(&x, twice));
  show(&x, word, &y, 'k');
  return 0;
}`);
    const inApply = on(steps, 8)[0];
    const apply = inApply.frames[1];
    expect(apply.arguments.map(({ name }) => name)).toEqual(['p', 'f']);
    expect(apply.arguments.map(({ value }) => value)).toEqual([
      shown(inApply, 'apply', 'p'),
      shown(inApply, 'apply', 'f'),
    ]);
    expect(argumentsOf(apply)).toMatch(
      /^p = 0x[0-9A-F]+, f = twice \(0x[0-9A-F]+\)$/
    );
    const inShow = on(steps, 12)[0];
    const show = inShow.frames[1];
    expect(show.arguments.map(({ value }) => value)).toEqual(
      ['p', 's', 'd', 'c'].map((name) => shown(inShow, 'show', name))
    );
    expect(argumentsOf(show)).toMatch(
      /^p = 0x[0-9A-F]+, s = 0x[0-9A-F]+, d = 0x[0-9A-F]+, c = 'k' \(107\)$/
    );
  });

  it('keep the value passed when the function changes its copy', () => {
    const steps = stepsOf(`int down(int n)
{
  while (n > 0) {
    n--;
  }
  return n;
}
int main(void)
{
  return down(3);
}`);
    const last = on(steps, 6)[0];
    expect(argumentsOf(last.frames[1])).toBe('n = 3');
  });
});
