import { Response, Server, SourceFile } from '../src/core';
import { exec } from './library';

/*
 * `assert` names the file and line it is written on, as `__FILE__` and
 * `__LINE__` would. The engine runs every file of a program as one
 * translation unit, and the message used to name `main.c` and count lines
 * from the top of that unit.
 */

const run = async (files: SourceFile[]): Promise<Response> => {
  const server = new Server();
  const finished = new Promise<Response>((resolve) => {
    server.onRunEvent = (_event, response) => resolve(response);
  });
  const logged = console.log;
  console.log = () => undefined;
  try {
    const started = await server.send({
      controlEvent: 'Exec',
      sourcecode: files[0].text,
      files,
      entry: files[0].path,
    });
    return started.debugState === 'Executing' ? await finished : started;
  } finally {
    console.log = logged;
  }
};

describe('an assertion that fails', () => {
  it('names a helper file and the line within it', async () => {
    const response = await run([
      {
        path: 'main.c',
        text: `#include <stdio.h>
int check(int value);

int main(void) {
  printf("start\\n");
  check(3);
  return 0;
}
`,
      },
      {
        path: 'check.c',
        text: `#include <assert.h>

int check(int value) {
  assert(value > 5);
  return value;
}
`,
      },
    ]);
    expect(response.output).toBe(
      'start\nAssertion failed: value > 5, file check.c, line 4\n'
    );
  });

  it('names the entry file when the assertion is there', async () => {
    const response = await run([
      {
        path: 'program.c',
        text: `#include <assert.h>
int helper(void);
int main(void) {
  int x = helper();
  assert(x == 2);
  return 0;
}
`,
      },
      { path: 'helper.c', text: 'int helper(void) {\n  return 1;\n}\n' },
    ]);
    expect(response.output).toBe(
      'Assertion failed: x == 2, file program.c, line 5\n'
    );
  });

  it('says main.c for a single program', async () => {
    const single = await exec(`#include <assert.h>
int main(void) {
  int x = 1;
  assert(x == 2);
  return 0;
}
`);
    expect(single.output).toBe(
      'Assertion failed: x == 2, file main.c, line 4\n'
    );
  });
});

describe('a refusal in a helper file', () => {
  it('counts the line in that file and names it', async () => {
    const response = await run([
      {
        path: 'main.c',
        text: `int divide(int a, int b);
int main(void) {
  return divide(1, 0);
}
`,
      },
      {
        path: 'math.c',
        text: `int divide(int a, int b) {
  int q = a / b;
  return q;
}
`,
      },
    ]);
    expect(response.output).toContain(
      'c-visualizer stopped the program on line 2 of math.c: division by zero'
    );
  });
});
