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

const run = (code: string): Session => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  let steps = 0;
  try {
    interpreter.startStepExecution(code);
    while (
      interpreter.isStepExecutionRunning() &&
      // A program blocked on a read never finishes; nothing here submits one.
      !interpreter.getIsWaitingForStdin() &&
      steps < 20000
    ) {
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
