import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { FoldState, extractModel } from '../src/core';
import { memoryGeometry } from '../src/ui/graph/geometry';

/**
 * The memory map inside the width it is given, laid out as the canvas lays it
 * out - with the segment names a reader sees, which is what makes the titles
 * long.
 *
 * Its two columns were widened to fit the longest segment title on one line
 * - `Zero-initialized static storage (BSS)` and its addresses - after the cap
 * that keeps them inside the canvas had been checked. With short rows and a
 * long title the right-hand column ran past the canvas, and the values it
 * right-aligns, the file-scope objects', were cut off: a global looked as if
 * nothing had ever set it.
 */

/** Where the layout starts its left column (`memoryLayout.ts`). */
const ORIGIN_X = 24;

/** The course's "Execution and memory" program, stopped where a reader saw it. */
const program = `#include <stdio.h>
#include <stddef.h>

#define SCALE(x) ((x) * 2)
#define SHOW_DETAIL 1

int total_calls;
static int offset = 10;
const int limit = 3;

struct Sample {
    char label[8];
    int values[3];
    unsigned int flags : 3;
};

union Reading {
    int integer;
    float real;
};

int factorial(int n)
{
    total_calls++;
    if (n <= 1)
        return 1;
    return n * factorial(n - 1);
}

int main(void)
{
    struct Sample sample = {"sensor", {3, 1, 4}, 5};
    union Reading reading;
    int matrix[2][3] = {{1, 2, 3}, {4, 5, 6}};
    char *names[] = {"wrist", "ankle"};
    int *p = sample.values;
    int *q = p + 2;
    ptrdiff_t distance = q - p;
    register int scaled = SCALE(*q);
    reading.integer = 42;
    int result = factorial(limit);
    printf("%d %d %td\\n", scaled, result, distance);
    return 0;
}
`;

/** The first state stopped on `if (n <= 1)` inside `factorial`. */
const breakpointState = (): ExecState => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  try {
    let state = interpreter.startStepExecution(program);
    while (interpreter.isStepExecutionRunning()) {
      state = interpreter.stepExecute();
      const model = extractModel(state);
      if (
        model.context.function === 'factorial' &&
        model.codeRange?.begin.y === 25
      ) {
        return state;
      }
    }
    throw new Error('never stopped on line 25');
  } finally {
    console.log = log;
  }
};

describe('the memory map', () => {
  it.each([600, 700, 839, 1000])(
    'stays inside %ipx when its titles are longer than its rows',
    (available) => {
      const model = extractModel(breakpointState());
      const geometry = memoryGeometry(
        model,
        new FoldState(),
        undefined,
        available
      );
      const right = Math.max(
        ...geometry.segments.map((segment) => segment.x + segment.width)
      );
      expect(right).toBeLessThanOrEqual(ORIGIN_X + available + 0.5);
      // The global the reader was looking for is still drawn with its value.
      const bss = geometry.segments.find((segment) => segment.key === 'bss')!;
      const row = bss.rows.find((one) =>
        one.cells.some((cell) => cell.key.startsWith('GLOBAL-total_calls'))
      )!;
      expect(row.cells.find((cell) => cell.kind === 'value')?.text).toBe('1');
    }
  );
});
