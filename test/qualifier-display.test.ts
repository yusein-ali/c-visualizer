import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { extractModel } from '../src/core/extractModel';
import { StepModel } from '../src/core';

/**
 * The qualifiers a declaration was written with, in both views.
 *
 * A parameter had no declaration information at all, so `const void *p1` was
 * drawn as `void*`, and the Variables view spelled every object without its
 * qualifiers while the memory view had them: `int*` beside `const int *`.
 */

const modelOnLine = (code: string, line: number): StepModel => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  try {
    let state = interpreter.startStepExecution(code);
    for (let count = 0; count < 200; count += 1) {
      const model = extractModel(state);
      if (model.codeRange?.begin.y === line) {
        return model;
      }
      state = interpreter.stepExecute();
    }
  } finally {
    console.log = log;
  }
  throw new Error(`no step on line ${line}`);
};

const program = `#include <stdio.h>
int compare(const void *p1, const void *p2)
{
  const int *a = p1;
  const int *b = p2;
  return *a - *b;
}
int main(void) { int x = 1, y = 2; printf("%d\\n", compare(&x, &y)); return 0; }`;

describe("a comparison function's parameters and locals", () => {
  it('are const in the Variables view', () => {
    const model = modelOnLine(program, 6);
    expect(
      model.variables
        .filter((variable) => variable.frame === 'compare')
        .map((variable) => `${variable.type} ${variable.name}`)
    ).toEqual([
      'const void * p1',
      'const void * p2',
      'const int * a',
      'const int * b',
    ]);
  });

  it('are const in the memory view', () => {
    const model = modelOnLine(program, 6);
    const stack = model.memory.find((segment) => segment.key === 'stack')!;
    const spelled = stack.rows.map((row) =>
      row
        .filter((cell) => cell.kind === 'type' || cell.kind === 'name')
        .map((cell) => cell.text)
        .join(' ')
    );
    expect(spelled).toEqual(
      expect.arrayContaining([
        'const void * p1',
        'const void * p2',
        'const int * a',
        'const int * b',
      ])
    );
  });
});
