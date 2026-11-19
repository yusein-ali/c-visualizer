import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { RuntimeDiagnostic } from '../src/interpreter/RuntimeDiagnostic';
import { Server } from '../src/core';

/**
 * What the run itself reports. The engine has always detected most of these
 * and printed a line about them; what is checked here is the other half - that
 * each one arrives as data, with the statement to blame, so the editor can
 * mark the line rather than leaving the reader to read the console.
 */

interface Session {
  diagnostics: RuntimeDiagnostic[];
  output: string;
  steps: number;
}

const run = (code: string, input: string | null = null): Session => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  let steps = 0;
  let pending = input;
  try {
    interpreter.startStepExecution(code);
    while (interpreter.isStepExecutionRunning() && steps < 20000) {
      if (interpreter.getIsWaitingForStdin()) {
        // A program blocked on a read never finishes: the input, where there
        // is one, is submitted once and then ended, as Ctrl+D ends it.
        if (pending === null) {
          break;
        }
        interpreter.stdin(pending);
        interpreter.endInput();
        pending = null;
      }
      interpreter.stepExecute();
      steps += 1;
    }
    return {
      diagnostics: interpreter.getRuntimeDiagnostics(),
      output: interpreter.getStdout(),
      steps,
    };
  } finally {
    console.log = log;
  }
};

const ruleOf = (session: Session): string[] =>
  session.diagnostics.map((diagnostic) => diagnostic.rule);

describe('dividing by zero', () => {
  const session = run(`#include <stdio.h>
int main(void) {
  int n = 4;
  int d = 0;
  printf("%d\\n", n / d);
  return 0;
}`);

  it('stops the program on the statement that did it', () => {
    const [found] = session.diagnostics;
    expect(found.rule).toBe('division-by-zero');
    expect(found.severity).toBe('error');
    expect(found.fatal).toBe(true);
    expect(found.line).toBe(5);
  });

  it('says the same thing on the console it always did', () => {
    expect(session.output).toContain('division by zero');
  });

  it('reports a remainder by zero as its own thing', () => {
    const [found] = run(`int main(void) {
  int n = 4;
  int d = 0;
  return n % d;
}`).diagnostics;
    expect(found.rule).toBe('division-by-zero');
    expect(found.message).toContain('remainder');
  });
});

describe('an index outside its array bounds', () => {
  it('names the index and the valid range', () => {
    const [found] = run(`int main(void) {
  int values[3] = {1, 2, 3};
  return values[5];
}`).diagnostics;
    expect(found.rule).toBe('array-out-of-bounds');
    expect(found.message).toContain('5');
    expect(found.message).toContain('0 through 2');
    expect(found.line).toBe(3);
  });

  it('catches a write as well as a read', () => {
    const [found] = run(`int main(void) {
  int values[2] = {1, 2};
  values[7] = 9;
  return 0;
}`).diagnostics;
    expect(found.rule).toBe('array-out-of-bounds');
    expect(found.line).toBe(3);
  });

  it('leaves an index inside the array alone', () => {
    const session = run(`int main(void) {
  int values[3] = {1, 2, 3};
  int total = 0;
  for (int i = 0; i < 3; i++) { total = total + values[i]; }
  return total;
}`);
    expect(session.diagnostics).toEqual([]);
  });

  it('says nothing about a pointer, whose length it cannot know', () => {
    const session = run(`#include <stdlib.h>
int main(void) {
  int *block = (int *)malloc(4 * 4);
  block[3] = 1;
  return 0;
}`);
    expect(ruleOf(session)).not.toContain('array-out-of-bounds');
  });
});

describe('a null pointer', () => {
  it('stops a dereference of it', () => {
    const [found] = run(`int main(void) {
  int *p = 0;
  return *p;
}`).diagnostics;
    expect(found.rule).toBe('null-dereference');
    expect(found.fatal).toBe(true);
    expect(found.line).toBe(3);
  });

  it('stops a subscript of it', () => {
    const [found] = run(`int main(void) {
  int *p = 0;
  return p[2];
}`).diagnostics;
    expect(found.rule).toBe('null-dereference');
    expect(found.line).toBe(3);
  });
});

describe('reading an object nothing has written', () => {
  it('says so without stopping the program', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  int n;
  printf("%d\\n", n + 1);
  return 0;
}`);
    const [found] = session.diagnostics;
    expect(found.rule).toBe('uninitialized-read');
    expect(found.severity).toBe('warning');
    expect(found.fatal).toBe(false);
    expect(found.line).toBe(4);
  });

  it('says it once however many times the read happens', () => {
    const session = run(`int main(void) {
  int n;
  int total = 0;
  for (int i = 0; i < 3; i++) { total = total + n; }
  return total;
}`);
    expect(
      ruleOf(session).filter((rule) => rule === 'uninitialized-read').length
    ).toBe(1);
  });

  it('says nothing once a value has arrived', () => {
    const session = run(`int main(void) {
  int n;
  n = 2;
  return n + 1;
}`);
    expect(session.diagnostics).toEqual([]);
  });

  it('counts scanf being pointed at it as a value arriving', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  int n;
  scanf("%d", &n);
  return n;
}`);
    expect(ruleOf(session)).not.toContain('uninitialized-read');
  });

  it('says nothing about a parameter or a global', () => {
    const session = run(`int counter;
int twice(int n) { return n * 2; }
int main(void) { return twice(2) + counter; }`);
    expect(session.diagnostics).toEqual([]);
  });
});

/**
 * A cell of a block `malloc` returned holds nothing until the program stores
 * into it. Its read was silent garbage in `int x = p[2];`, stopped the run
 * with "could not be executed" in `t += p[2];` and `if (p[2] > 5)`, and was
 * reported only as a `printf` argument. Each is now the read of an object
 * nothing has written, as a local's is: said once, and the run goes on - an
 * element of a local array too, which was said nowhere.
 */
describe('reading an element nothing has written', () => {
  const unwritten = (
    message: string
  ): Pick<RuntimeDiagnostic, 'rule' | 'severity' | 'fatal' | 'message'> => ({
    rule: 'uninitialized-read',
    severity: 'warning',
    fatal: false,
    message:
      `${message} is evaluated before a value is stored in it; its value ` +
      `is indeterminate, and using that value has undefined behavior`,
  });
  const reported = (session: Session) =>
    session.diagnostics.map(({ rule, severity, fatal, message, line }) => ({
      rule,
      severity,
      fatal,
      message,
      line,
    }));

  it.each([
    ['an initializer', 'int x = p[2];'],
    ['a compound assignment', 'int t = 1;\n  t += p[2];'],
    ['a condition', 'if (p[2] > 5) { p[0] = 1; }'],
    ['an operand', 'int y = p[2] + 1;'],
    ['a printf argument', 'printf("%d\\n", p[2]);'],
  ])('in a heap block, read in %s', (_where, statement) => {
    const session = run(`#include <stdio.h>
#include <stdlib.h>
int main(void) {
  int *p = malloc(3 * sizeof(int));
  ${statement}
  printf("end\\n");
  free(p);
  return 0;
}`);
    expect(reported(session)).toEqual([
      { ...unwritten('p[2]'), line: statement.includes('\n') ? 6 : 5 },
    ]);
    expect(session.output).toMatch(/end\n$/);
  });

  it('through a dereference, once however often, and not once written', () => {
    const session = run(`#include <stdlib.h>
int main(void) {
  int *p = malloc(2 * sizeof(int));
  int total = 0;
  for (int i = 0; i < 3; i++) {
    total += *p;
  }
  p[1] = 4;
  total += p[1];
  free(p);
  return total;
}`);
    expect(reported(session)).toEqual([{ ...unwritten('*p'), line: 6 }]);
  });

  it('in a local array', () => {
    const session = run(`int main(void) {
  int a[3];
  a[0] = 1;
  int t = a[0];
  t += a[2];
  return t;
}`);
    expect(reported(session)).toEqual([{ ...unwritten('a[2]'), line: 5 }]);
  });

  it('says nothing about calloc, which fills its block with zero', () => {
    const session = run(`#include <stdio.h>
#include <stdlib.h>
int main(void) {
  int *p = calloc(3, sizeof(int));
  printf("%d\\n", p[2] + 1);
  free(p);
  return 0;
}`);
    expect(session.diagnostics).toEqual([]);
    expect(session.output).toBe('1\n');
  });
});

/**
 * The objects of a frame that has returned are gone, and so are their marks:
 * a `char title[80]` left mostly unwritten made the next function's `int i
 * = 0;` at the same addresses an "uninitialized read". A new frame's objects
 * start fresh - initialized means written - and one declared without an
 * initializer is reported when it is read before it is written.
 */
describe('reading an object where a returned frame left one unwritten', () => {
  it('says nothing about an initialized object or a parameter', () => {
    const session = run(`#include <stdio.h>
void read_nothing(void)
{
  char title[80];
  title[0] = '\\0';
  printf("%s", title);
}
int twice(int n)
{
  int i = 0;
  int sum = n;
  while (i < n) {
    i++;
  }
  return sum + i;
}
void count(int n)
{
  int i = 0;
  while (i < n) {
    i++;
  }
  printf("%d %d\\n", i, twice(i));
}
int main(void)
{
  read_nothing();
  count(3);
  read_nothing();
  printf("%d\\n", twice(2));
  return 0;
}`);
    expect(session.diagnostics).toEqual([]);
    expect(session.output).toBe('3 6\n4\n');
  });

  it('still reports a new object declared without an initializer', () => {
    const session = run(`#include <stdio.h>
void first(void)
{
  int a;
  a = 42;
  printf("%d\\n", a);
}
int second(void)
{
  int y;
  return y + 1;
}
int main(void)
{
  first();
  second();
  for (int k = 0; k < 3; k++) {
    second();
  }
  return 0;
}`);
    expect(
      session.diagnostics.map(({ rule, message, line }) => [
        rule,
        message.split(' ')[0],
        line,
      ])
    ).toEqual([['uninitialized-read', 'y', 11]]);
  });
});

/**
 * An array used as a value is the address of its first element (C11
 * 6.3.2.1p3): `scanf(" %79[^;];", title)` and `add_book(titles, ...)` evaluate
 * no element, so nothing indeterminate is read. The T5.2 shelf warned "title
 * is evaluated before a value is stored in it" all the same: a declaration of
 * a two-dimensional array marked its elements unwritten from its table of
 * rows on, not where the rows are, which covered where the next arrays' names
 * were filed. An element, a whole scalar, or the characters a library
 * function reads are still reported when nothing has written them.
 */
describe('an array used as a value', () => {
  const said = (session: Session) =>
    session.diagnostics.map(({ rule, message, line }) => [
      rule,
      message.split(' ')[0],
      line,
    ]);

  it('reads no element when scanf or a function is handed it', () => {
    const session = run(
      `#include <stdio.h>
int add_book(char titles[][40], int count, const char *title)
{
  (void)titles;
  (void)title;
  return count;
}
int main(void)
{
  char titles[10][40];
  int count = 0;
  char command;
  while (scanf(" %c", &command) == 1 && command != 'Q') {
    char title[80];
    if (command == 'A') {
      if (scanf(" %79[^;];", title) != 1) {
        continue;
      }
      if (add_book(titles, count, title) == count) {
        printf("full: %s\\n", title);
      }
    }
  }
  return 0;
}`,
      'A Dune; A Emma; A Kalevala; Q\n'
    );
    expect(session.diagnostics).toEqual([]);
    expect(session.output).toMatch(/full: Dune\nfull: Emma\nfull: Kalevala\n$/);
  });

  it('reads no element as an operand, an initializer or a row', () => {
    const session = run(`#include <stdio.h>
#include <string.h>
int main(void) {
  char rows[3][8];
  char word[10];
  char *end = word + 9;
  char *p = word;
  char *row = rows[1];
  strcpy(p, "hi");
  *end = '\\0';
  strcpy(row, word);
  strcpy(rows[0], "up");
  printf("%s %s %s\\n", word, rows[1], rows[0]);
  return 0;
}`);
    expect(session.diagnostics).toEqual([]);
    expect(session.output).toBe('hi hi up\n');
  });

  it('still reports an element of a two-dimensional array nothing wrote', () => {
    const session = run(`int main(void) {
  int m[2][3];
  m[0][0] = 1;
  int x = m[1][2];
  return x + m[0][0];
}`);
    expect(said(session)).toEqual([['uninitialized-read', 'm[1][2]', 4]]);
  });

  it('still reports a scalar read before it is written', () => {
    const session = run(`int main(void) {
  int m[4][4];
  int k;
  m[0][0] = 1;
  return m[0][0] + k;
}`);
    expect(said(session)).toEqual([['uninitialized-read', 'k', 5]]);
  });

  it.each([
    ['an array', 'char title[80];', 'title', 'title'],
    ['a row', 'char rows[2][80];', 'rows[1]', 'rows'],
  ])(
    'still reports strlen reading the characters of %s nothing wrote',
    (_what, declaration, argument, object) => {
      const session = run(`#include <stdio.h>
#include <string.h>
int main(void) {
  ${declaration}
  printf("%zu\\n", strlen(${argument}));
  return 0;
}`);
      // What the characters hold is random, so whether a null character
      // ends them in time, and the run goes on, is too.
      expect(said(session)[0]).toEqual(['uninitialized-read', 'strlen', 5]);
      expect(session.diagnostics[0].message).toContain(`from ${object} `);
    }
  );
});

/**
 * `return;` in a function returning `void` has no expression, and the stock
 * engine evaluated the missing one: every executed `return;` was a fatal
 * "could not be executed", though the run then went on as it should.
 */
describe('a return without a value', () => {
  it('leaves a void function quietly, at its end or early', () => {
    const session = run(`#include <stdio.h>
void g(void)
{
  return;
}
void first_negative(const int *a, int n)
{
  for (int i = 0; i < n; i++) {
    if (a[i] < 0) {
      printf("%d at %d\\n", a[i], i);
      return;
    }
  }
  printf("none\\n");
}
void f(int n)
{
  g();
  printf("%d\\n", n);
}
int main(void)
{
  int a[4] = {3, -1, 4, -5};
  f(1);
  first_negative(a, 4);
  first_negative(a, 1);
  return 0;
}`);
    expect(session.diagnostics).toEqual([]);
    expect(session.output).toBe('1\n-1 at 1\nnone\n');
  });
});

describe('a statement the interpreter cannot execute', () => {
  it('turns a swallowed interpreter exception into a located fatal diagnostic', () => {
    const session = run(`int main(void) {
  int value = missing + 1;
  return value;
}`);
    const [found] = session.diagnostics;

    expect(found).toMatchObject({
      rule: 'invalid-statement',
      severity: 'error',
      line: 2,
      fatal: true,
    });
  });
});

describe('the session that carries them', () => {
  it('sends what the run has said with every step, and nothing once stopped', async () => {
    const server = new Server();
    const code = `int main(void) {
  int d = 0;
  return 4 / d;
}`;
    const request = (controlEvent: 'Start' | 'Step' | 'Stop') =>
      server.send({
        controlEvent,
        sourcecode: code,
        files: [{ path: 'main.c', text: code }],
        entry: 'main.c',
      });
    await request('Start');
    let response = await request('Step');
    while (response.debugState !== 'EOF') {
      response = await request('Step');
    }
    expect(response.runtime!.map((one) => one.rule)).toEqual([
      'division-by-zero',
    ]);
    expect(response.location).toMatchObject({
      path: 'main.c',
      range: { begin: { y: 3 } },
    });

    const stopped = await request('Stop');
    expect(stopped.runtime).toEqual([]);
  });
});
