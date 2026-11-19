import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { LintDiagnostic } from '../src/interpreter/TeachingLint';
import { CONTROL_EVENT, Response, Server } from '../src/core';

/**
 * A call of a function nothing declares. C99 removed implicit function
 * declarations, and gcc 14 refuses the call as an error ("implicit
 * declaration of function 'reading_minutes'"); the visualizer ran the
 * program and stopped at the call with "This statement could not be
 * executed". The course's warm-ups are in this state until the student
 * writes the function or the macro, so the refusal is what they meet first.
 *
 * Only a name that no file of the program declares, as anything, and that
 * the library does not provide: a function one file defines and another
 * calls without a prototype, which gcc would also refuse, is not reported -
 * the files are combined into one program here, and the rule is not to
 * refuse a program that runs.
 */

const RULE = 'implicit-function-declaration';

const quiet = async <T>(run: () => Promise<T> | T): Promise<T> => {
  const logged = console.log;
  const errored = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.log = logged;
    console.error = errored;
  }
};

const lint = (code: string): Promise<LintDiagnostic[]> =>
  quiet(() => new PlivetCPP14Interpreter().getLints(code));

const found = async (code: string): Promise<LintDiagnostic[]> =>
  (await lint(code)).filter((diagnostic) => diagnostic.rule === RULE);

/** Where `text` first starts in the source, as the parser counts. */
const at = (code: string, text: string) => {
  const lines = code.split('\n');
  const line = lines.findIndex((one) => one.includes(text));
  return { line: line + 1, column: lines[line].indexOf(text) };
};

const readingTime = `#include <stdio.h>

/* Declare reading_minutes here. */

int main(void)
{
\tint pages = 272;

\tprintf("Reading time: %d minutes\\n", reading_minutes(pages, 2));
\treturn 0;
}
`;

const book = `/* Define reading_minutes here. It returns the number of minutes that
   reading \`pages\` pages takes at \`minutes_per_page\` minutes per page. */
`;

const shelfMain = `#include <stdio.h>
#include "shelf.h"

int main(void)
{
\tint first = 272;
\tint second = 310;
\tint preface = 28;

\tprintf("Reading time: %d minutes\\n", MINUTES(first + preface));
\tprintf("The longer book has %d pages\\n", LONGER(first, second));
\tprintf("Two of it: %d pages\\n", 2 * LONGER(first, second));
\treturn 0;
}
`;

const shelfHeader = (
  macros: string
) => `/* shelf.h: the macros of the bookshelf. */
#ifndef SHELF_H
#define SHELF_H

#define MINUTES_PER_PAGE 2

${macros}

#endif
`;

const message = (name: string) => `implicit declaration of function '${name}'`;

describe('a call of a function nothing declares', () => {
  it('is an error at the call, in the words gcc uses', async () => {
    const [diagnostic, ...rest] = await found(readingTime);
    expect(rest).toEqual([]);
    expect(diagnostic).toMatchObject({
      rule: RULE,
      severity: 'error',
      ...at(readingTime, 'reading_minutes('),
    });
    expect(diagnostic.message.startsWith(message('reading_minutes'))).toBe(
      true
    );
  });

  it('is said once for each name, a macro-cased one too', async () => {
    const program = shelfMain.replace('#include "shelf.h"\n', '');
    expect(
      (await found(program)).map((diagnostic) => [
        diagnostic.line,
        diagnostic.message.split(':')[0],
      ])
    ).toEqual([
      [at(program, 'MINUTES(').line, message('MINUTES')],
      [at(program, 'LONGER(').line, message('LONGER')],
    ]);
  });

  it.each([
    [
      'a library function',
      `#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <assert.h>
int main(void) {
  char *s = malloc(4);
  strcpy(s, "ab");
  assert(strlen(s) == 2);
  printf("%d\\n", abs(-2));
  free(s);
  return 0;
}`,
    ],
    [
      'a variadic function and its macros',
      `#include <stdarg.h>
int sum(int n, ...) {
  va_list ap;
  va_start(ap, n);
  int total = 0;
  for (int i = 0; i < n; i++) { total += va_arg(ap, int); }
  va_end(ap);
  return total;
}
int main(void) { return sum(2, 1, 2); }`,
    ],
    [
      'a function defined below its call',
      `int main(void) { return twice(2); }
int twice(int n) { return 2 * n; }`,
    ],
    [
      'a function only declared',
      `int twice(int n);
int main(void) { return twice(2); }`,
    ],
    [
      'a function declared in a block',
      `int main(void) {
  int twice(int n);
  return twice(2);
}
int twice(int n) { return 2 * n; }`,
    ],
    [
      'a function pointer parameter, local and global',
      `int add(int a, int b) { return a + b; }
int (*chosen)(int, int) = add;
int apply(int (*op)(int, int), int a, int b) { return op(a, b); }
int main(void) {
  int (*local)(int, int) = add;
  return apply(add, 1, 2) + local(3, 4) + chosen(5, 6);
}`,
    ],
    [
      'a function pointer through a typedef, an array or a member',
      `typedef int (*Op)(int);
int twice(int n) { return 2 * n; }
struct row { Op run; };
int main(void) {
  Op ops[1] = {twice};
  struct row r = {twice};
  Op f = twice;
  return ops[0](1) + r.run(2) + (*f)(3) + f(4);
}`,
    ],
    [
      'a function-like macro',
      `#define TWICE(n) (2 * (n))
int main(void) { return TWICE(2); }`,
    ],
  ])('is not said of %s', async (_what, code) => {
    // The control proves the program was checked: only it is said.
    const checked = `${code}\nint control(void) { return nowhere(); }\n`;
    expect(
      (await found(checked)).map((diagnostic) => diagnostic.message)
    ).toEqual([
      expect.stringMatching(/^implicit declaration of function 'nowhere'/),
    ]);
  });
});

describe('a program that calls a function nothing declares', () => {
  /** Runs the files to the end, or to the refusal of the start. */
  const execute = async (
    files: { path: string; text: string }[]
  ): Promise<Response> => {
    const server = new Server();
    const finished = new Promise<Response>((resolve) => {
      server.onRunEvent = (_event, response) => resolve(response);
    });
    const started = await quiet(() =>
      server.send({
        controlEvent: 'Exec',
        sourcecode: files[0].text,
        files,
        entry: 'main.c',
        active: 'main.c',
      })
    );
    return started.debugState === 'Executing'
      ? await quiet(() => finished)
      : started;
  };
  const send = (
    controlEvent: CONTROL_EVENT,
    files: { path: string; text: string }[]
  ): Promise<Response> =>
    quiet(() =>
      new Server().send({
        controlEvent,
        sourcecode: files[0].text,
        files,
        entry: 'main.c',
        active: 'main.c',
      })
    );

  it.each(['Exec', 'Start'] as const)(
    'is refused at %s, at the call, in the file that makes it',
    async (controlEvent) => {
      const response = await send(controlEvent, [
        { path: 'main.c', text: readingTime },
        { path: 'book.c', text: book },
      ]);
      const call = at(readingTime, 'reading_minutes(');
      expect(response.debugState).toBe('Stop');
      expect(response.diagnosticPath).toBe('main.c');
      expect(response.errors).toEqual([
        {
          line: call.line,
          charPositionInLine: call.column,
          msg: expect.stringContaining(message('reading_minutes')),
        },
      ]);
    },
    30000
  );

  it('is refused for each macro a header does not define yet', async () => {
    const response = await send('Start', [
      { path: 'main.c', text: shelfMain },
      {
        path: 'shelf.h',
        text: shelfHeader('/* Define MINUTES(pages) and LONGER(a, b) here. */'),
      },
    ]);
    expect(response.debugState).toBe('Stop');
    expect(
      response.errors!.map((error) => [error.line, error.msg.split(':')[0]])
    ).toEqual([
      [at(shelfMain, 'MINUTES(').line, message('MINUTES')],
      [at(shelfMain, 'LONGER(').line, message('LONGER')],
    ]);
  }, 30000);

  it.each([
    [
      'declared in one file and defined in another',
      readingTime.replace(
        '/* Declare reading_minutes here. */',
        'int reading_minutes(int pages, int minutes_per_page);'
      ),
    ],
    // gcc refuses this one too; the files run as one program here.
    ['defined in another file and not declared', readingTime],
  ])(
    'runs once the function is %s',
    async (_how, main) => {
      const response = await execute([
        { path: 'main.c', text: main },
        {
          path: 'book.c',
          text: `${book}int reading_minutes(int pages, int minutes_per_page)
{
\treturn pages * minutes_per_page;
}
`,
        },
      ]);
      expect(response.errors ?? []).toEqual([]);
      expect(response.output).toBe('Reading time: 544 minutes\n');
      expect(response.runtime ?? []).toEqual([]);
    },
    30000
  );

  it('runs once the header defines the macros', async () => {
    const response = await execute([
      { path: 'main.c', text: shelfMain },
      {
        path: 'shelf.h',
        text: shelfHeader(
          '#define MINUTES(pages) ((pages) * MINUTES_PER_PAGE)\n' +
            '#define LONGER(a, b) ((a) > (b) ? (a) : (b))'
        ),
      },
    ]);
    expect(response.errors ?? []).toEqual([]);
    expect(response.output).toBe(
      'Reading time: 600 minutes\nThe longer book has 310 pages\n' +
        'Two of it: 620 pages\n'
    );
    expect(response.runtime ?? []).toEqual([]);
  }, 30000);
});

/**
 * Run without the check before it - the interpreter driven directly - the
 * call is refused where it is made, with the same words, rather than with
 * "This statement could not be executed".
 */
describe('a call of a function nothing declares, reached at run time', () => {
  it('stops the program at the call, in the words gcc uses', () => {
    const interpreter = new PlivetCPP14Interpreter();
    interpreter.setFileList(new Map());
    const logged = console.log;
    console.log = () => undefined;
    try {
      interpreter.startStepExecution(readingTime);
      for (
        let steps = 0;
        interpreter.isStepExecutionRunning() && steps < 1000;
        steps += 1
      ) {
        interpreter.stepExecute();
      }
    } finally {
      console.log = logged;
    }
    expect(interpreter.getRuntimeDiagnostics()).toEqual([
      expect.objectContaining({
        rule: RULE,
        severity: 'error',
        fatal: true,
        line: at(readingTime, 'reading_minutes(').line,
        message: expect.stringContaining(message('reading_minutes')),
      }),
    ]);
    expect(interpreter.getStdout()).toContain(message('reading_minutes'));
  });
});
