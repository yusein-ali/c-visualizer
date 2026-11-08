import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import * as cloning from 'unicoen.ts/dist/node_helper/clone';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { makeState, snapshotOf } from '../src/interpreter/StateSnapshot';
import { exec } from './library';

/*
 * What a step costs.
 *
 * Upstream ends every step with `ExecState.make()`, which probes every
 * address from 10000 to 50000, and a deep copy whose memo is a list searched
 * linearly. A 2000-iteration loop took seconds. `StateSnapshot.ts` builds
 * the same state from the addresses that hold something and keeps the copy a
 * step needs; these tests hold it to the same result.
 */

const quietly = <T>(work: () => T): T => {
  const logged = console.log;
  console.log = () => undefined;
  try {
    return work();
  } finally {
    console.log = logged;
  }
};

interface Shape {
  type: string | null;
  name: string;
  address: number;
  depth: number;
  value: unknown;
}

const shapeOf = (variable: Variable): Shape => {
  const value = variable.getValue();
  return {
    type: variable.type,
    name: variable.name,
    address: variable.address,
    depth: variable.depth,
    value: Array.isArray(value)
      ? value.map(shapeOf)
      : value === null || typeof value === 'undefined'
        ? value
        : String(value.valueOf()),
  };
};

const stacksOf = (state: ExecState) =>
  state.getStacks().map((stack) => ({
    name: stack.name,
    address: stack.address,
    variables: stack.getVariables().map(shapeOf),
  }));

const programs = [
  `#include <stdio.h>
#include <stdlib.h>
struct P { int x; double y; };
struct Q { struct P p; char tag; };
int g[3] = {1, 2, 3};
char *msg = "hi";
int twice(int v) { int w = v * 2; return w; }
int main(void) {
  int m[2][3] = {{1, 2, 3}, {4, 5, 6}};
  struct Q q = {{1, 2.5}, 'a'};
  struct P ps[2];
  int *heap = malloc(3 * sizeof(int));
  struct P *rec = malloc(2 * sizeof(struct P));
  for (int i = 0; i < 3; i++) {
    heap[i] = twice(i);
    g[i] += m[1][i];
  }
  rec[1].x = q.p.x;
  ps[1] = rec[1];
  printf("%s %d\\n", msg, g[2]);
  free(heap);
  return 0;
}
`,
  `#include <stdio.h>
int main(void) {
  char *names[] = {"ann", "bob"};
  double d[2] = {1.5, 2.5};
  double *p = d;
  p++;
  printf("%s %g\\n", names[1], *p);
  return 0;
}
`,
];

describe('makeState', () => {
  it.each(programs.map((code, index) => [index, code]))(
    'builds the stacks ExecState.make builds, at every step of program %i',
    (_index, code) => {
      quietly(() => {
        const interpreter = new PlivetCPP14Interpreter();
        const engine = (
          interpreter as unknown as {
            plivetEngine: { currentState: ExecState };
          }
        ).plivetEngine;
        interpreter.startStepExecution(code as string);
        let steps = 0;
        do {
          const global = (engine.currentState as unknown as { global: never })
            .global;
          const stock = new ExecState(global).make();
          const ours = makeState(new ExecState(global));
          expect(stacksOf(ours)).toEqual(stacksOf(stock));
          interpreter.stepExecute();
          steps += 1;
        } while (interpreter.isStepExecutionRunning() && steps < 500);
        expect(steps).toBeGreaterThan(3);
      });
    }
  );
});

describe('snapshotOf', () => {
  it('keeps the write log as it stood, whatever the log does next', () => {
    const state = new ExecState();
    const log = [{ target: 'a' }, { target: 'b' }];
    Object.assign(state, { plivetMutations: log, plivetMutationCount: 2 });
    const kept = snapshotOf(state);
    log.shift();
    log.push({ target: 'c' }, { target: 'd' });
    expect(
      (kept as unknown as { plivetMutations: unknown[] }).plivetMutations
    ).toEqual([{ target: 'a' }, { target: 'b' }]);
    expect(Object.getPrototypeOf(kept)).toBe(ExecState.prototype);
  });

  it('is a separate state from the one the engine goes on writing to', () => {
    const state = new ExecState();
    state.setNextExpr(null as never);
    const kept = snapshotOf(state);
    state.setCurrenValue(5);
    expect(kept.getCurrentValue()).toBeUndefined();
  });
});

describe('a run', () => {
  it('neither deep-copies its states nor scans the address space', async () => {
    const copy = jest.spyOn(cloning, 'clone');
    const make = jest.spyOn(ExecState.prototype, 'make');
    try {
      const run = await exec(`#include <stdio.h>
int main(void) {
  int total = 0;
  for (int i = 0; i < 200; i++) {
    total += i;
  }
  printf("%d\\n", total);
  return 0;
}
`);
      expect(run.output).toBe('19900\n');
      // A new scope still copies its (empty) import list; no state is copied.
      expect(
        copy.mock.calls.some(([value]) => value instanceof ExecState)
      ).toBe(false);
      expect(make).not.toHaveBeenCalled();
    } finally {
      copy.mockRestore();
      make.mockRestore();
    }
  });
});
