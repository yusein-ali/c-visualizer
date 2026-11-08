import { libraryHelp } from '../src/app/libraryHelp';
import { Server, StepModel } from '../src/core';
import { extractModel } from '../src/core/extractModel';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { exec, outputOf, rulesOf, targetOf, typeOf, valueOf } from './library';

/**
 * `<stdarg.h>` and the `v*printf` family (L14): a function declared with
 * `...` keeps its unnamed arguments in its frame, after the named ones, as
 * rows `...[0]`, `...[1]`; a `va_list` is a pointer that walks them.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdarg.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

const SUM = `int sum(int count, ...) {
  va_list ap;
  va_start(ap, count);
  int total = 0;
  for (int i = 0; i < count; i++) {
    int next = va_arg(ap, int);
    total = total + next;
  }
  va_end(ap);
  return total;
}`;

const stepsOf = (code: string): StepModel[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const steps: StepModel[] = [];
  try {
    let state = interpreter.startStepExecution(code);
    let count = 0;
    while (interpreter.isStepExecutionRunning() && count < 1000) {
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

describe('a function declared with ...', () => {
  it('reads its unnamed arguments with va_arg', async () => {
    const run = await exec(
      program(
        `  printf("%d %d %d\\n", sum(3, 1, 2, 3), sum(0), sum(1, 'A'));`,
        SUM
      )
    );
    expect(run.output).toBe('6 0 65\n');
    expect(run.runtime).toEqual([]);
  });

  it('draws the unnamed arguments as rows of the frame, and ap as a pointer onto them', () => {
    const steps = stepsOf(program(`  int s = sum(2, 10, 20);`, SUM));
    // `total = total + next;` on line 9, once per argument.
    const reading = steps.filter(
      (step) => step.codeRange !== null && step.codeRange.begin.y === 9
    );
    expect(reading.length).toBe(2);
    const first = reading[0];
    expect(valueOf(first, 'count')).toBe('2');
    expect(valueOf(first, '...[0]')).toBe('10');
    expect(valueOf(first, '...[1]')).toBe('20');
    expect(typeOf(first, '...[0]')).toBe('int');
    expect(typeOf(first, 'ap')).toBe('va_list');
    // One va_arg has run: ap points at the second unnamed argument.
    expect(targetOf(first, 'ap')).toBe('...[1]');
    // After the last, it points past them, at nothing.
    expect(targetOf(reading[1], 'ap')).toBeNull();
    expect(valueOf(reading[1], 'ap')).toMatch(/^0x/);
  });

  it('records in the mutation view which argument the list points at', async () => {
    const run = await exec(program(`  int s = sum(2, 10, 20);`, SUM));
    expect(
      run.model.mutations
        .filter((one) => one.target === 'ap')
        .map((one) => [one.before, one.after, one.line])
    ).toEqual([
      ['?', 'points at ...[0]', 5],
      ['points at ...[0]', 'points at ...[1]', 8],
      ['points at ...[1]', 'past the last unnamed argument', 8],
      ['past the last unnamed argument', 'ended', 11],
    ]);
    expect(run.model.mutations.every((one) => one.frame !== '')).toBe(true);
  });

  it('promotes char and float arguments, and keeps strings and pointers', async () => {
    const run = await exec(
      program(
        `  char c = 'z';
  float f = 1.5f;
  int n = 4;
  show(3, c, f, "text", &n);`,
        `void show(int count, ...) {
  va_list ap;
  va_start(ap, count);
  int c = va_arg(ap, int);
  double f = va_arg(ap, double);
  char *s = va_arg(ap, char *);
  int *p = va_arg(ap, int *);
  printf("%c %.1f %s %d\\n", c, f, s, *p);
  va_end(ap);
}`
      )
    );
    expect(run.output).toBe('z 1.5 text 4\n');
    expect(run.runtime).toEqual([]);
  });

  it('works through va_copy, and when called through a pointer', async () => {
    expect(
      await outputOf(
        program(
          `  int (*f)(int, ...) = twice;
  printf("%d\\n", f(2, 5, 7));`,
          `int twice(int count, ...) {
  va_list ap, again;
  va_start(ap, count);
  va_copy(again, ap);
  int total = 0;
  for (int i = 0; i < count; i++) {
    total = total + va_arg(ap, int);
  }
  for (int i = 0; i < count; i++) {
    total = total + va_arg(again, int);
  }
  va_end(again);
  va_end(ap);
  return total;
}`
        )
      )
    ).toBe('24\n');
  });

  it('refuses va_arg of a type no unnamed argument can have', async () => {
    const run = await exec(
      program(
        `  f(1, 'x');`,
        `void f(int n, ...) {
  va_list ap;
  va_start(ap, n);
  char c = va_arg(ap, char);
  va_end(ap);
}`
      )
    );
    expect(rulesOf(run)).toEqual(['va-arg-promoted']);
    expect(run.runtime[0].message).toContain('promoted to int');
  });

  it('refuses va_arg of another kind of type than was passed', async () => {
    const run = await exec(
      program(
        `  f(1, 3);`,
        `void f(int n, ...) {
  va_list ap;
  va_start(ap, n);
  double d = va_arg(ap, double);
  va_end(ap);
}`
      )
    );
    expect(rulesOf(run)).toEqual(['va-arg-type']);
    expect(run.runtime[0].message).toContain(
      'va_arg asks for double, but ...[0], the next unnamed argument, was passed as int'
    );
  });

  it('warns about a signed/unsigned-incompatible pair of the same width', async () => {
    const run = await exec(
      program(
        `  f(1, 3);`,
        `void f(int n, ...) {
  va_list ap;
  va_start(ap, n);
  long v = va_arg(ap, long);
  printf("%ld\\n", v);
  va_end(ap);
}`
      )
    );
    expect(run.output).toBe('3\n');
    expect(rulesOf(run)).toEqual(['va-arg-type']);
    expect(run.runtime[0].severity).toBe('warning');
  });

  it('refuses a read past the last unnamed argument', async () => {
    const run = await exec(program(`  sum(3, 1, 2);`, SUM));
    expect(rulesOf(run)).toEqual(['va-arg-past-end']);
    expect(run.runtime[0].message).toContain('only 2 unnamed arguments');
  });

  it('refuses va_start outside a function declared with ...', async () => {
    const run = await exec(
      program(
        `  f(1);`,
        `void f(int n) {
  va_list ap;
  va_start(ap, n);
}`
      )
    );
    expect(rulesOf(run)).toEqual(['va-start-outside-variadic']);
  });

  it('refuses va_arg on a list that was never started, or has ended', async () => {
    const run = await exec(
      program(
        `  f(1, 2);`,
        `void f(int n, ...) {
  va_list ap;
  va_start(ap, n);
  va_end(ap);
  int x = va_arg(ap, int);
}`
      )
    );
    expect(rulesOf(run)).toEqual(['va-arg-without-start']);
  });

  it('warns when va_start names a parameter other than the last', async () => {
    const run = await exec(
      program(
        `  printf("%d\\n", f(1, 2, 9));`,
        `int f(int a, int b, ...) {
  va_list ap;
  va_start(ap, a);
  int v = va_arg(ap, int);
  va_end(ap);
  return v;
}`
      )
    );
    expect(run.output).toBe('9\n');
    expect(rulesOf(run)).toEqual(['va-start-last']);
  });

  it('refuses a structure passed through ...', async () => {
    const run = await exec(
      program(
        `  struct P p = {1};
  f(1, p);`,
        `struct P { int x; };
void f(int n, ...) {
}`
      )
    );
    expect(rulesOf(run)).toEqual(['variadic-record']);
  });
});

describe('the v*printf family', () => {
  const LOGGERS = `void say(const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  vprintf(format, ap);
  va_end(ap);
}
void warn(const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  vfprintf(stdout, format, ap);
  va_end(ap);
}
int into(char *buffer, int size, const char *format, ...) {
  va_list ap, copy;
  va_start(ap, format);
  va_copy(copy, ap);
  int n = vsnprintf(buffer, size, format, ap);
  char whole[32];
  vsprintf(whole, format, copy);
  printf("[%s] ", whole);
  va_end(copy);
  va_end(ap);
  return n;
}`;

  it('formats the arguments a va_list stands for', async () => {
    const run = await exec(
      program(
        `  char buf[4];
  say("%d + %d = %s\\n", 2, 3, "five");
  warn("%.2f%c\\n", 0.5, '!');
  int n = into(buf, sizeof buf, "%d-%s", 42, "ab");
  printf("%d [%s]\\n", n, buf);`,
        LOGGERS
      )
    );
    expect(run.output).toBe('2 + 3 = five\n0.50!\n[42-ab] 5 [42-]\n');
    expect(run.runtime).toEqual([]);
  });

  it('refuses arguments in place of a va_list', async () => {
    const run = await exec(program(`  vprintf("%d\\n", 5);`));
    expect(rulesOf(run)).toEqual(['invalid-va-list']);
  });
});

it('lints a v*printf call handed values instead of a va_list', async () => {
  const code = program(
    `  say("%d\\n", 1);
  vprintf("%d\\n", 5);`,
    `void say(const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  vprintf(format, ap);
  va_end(ap);
}`
  );
  const log = console.log;
  console.log = () => undefined;
  try {
    const response = await new Server().send({
      controlEvent: 'SyntaxCheck',
      sourcecode: code,
      files: [{ path: 'main.c', text: code }],
      entry: 'main.c',
    });
    expect(response.errors).toEqual([]);
    const lints = (response.lints ?? []).filter(
      (lint) => lint.rule === 'va-list-argument'
    );
    expect(lints.length).toBe(1);
    expect(lints[0].message).toContain('pass those to printf instead');
  } finally {
    console.log = log;
  }
});

it('documents <stdarg.h> and the v*printf family', () => {
  for (const name of ['va_start', 'va_arg', 'va_copy', 'va_end', 'va_list']) {
    expect(libraryHelp(name)).toMatchObject({ header: 'stdarg.h' });
  }
  for (const name of ['vprintf', 'vfprintf', 'vsprintf', 'vsnprintf']) {
    expect(libraryHelp(name)).toMatchObject({ header: 'stdio.h' });
  }
});
