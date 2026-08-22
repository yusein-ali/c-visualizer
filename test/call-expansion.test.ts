import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { extractModel } from '../src/core/extractModel';
import {
  CallExpansionModel,
  ExpressionNodeModel,
  StepModel,
} from '../src/core';
import { callHeading } from '../src/ui/graph';

/**
 * A call and its arguments, treated as one thing.
 *
 * Arguments are what a single call operator binds, positionally and at once,
 * so the unit these check is the call: the parameter each argument fills is
 * carried on the argument node itself, and a call the statement buries gets a
 * view rooted at the call rather than at any one argument. The canvas that
 * draws them is checked in a browser - JointJS does not run under jsdom - so
 * everything here stops at the model and the heading.
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
    while (interpreter.isStepExecutionRunning() && count < 400) {
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

/** The first step that expanded any call, and the step's own tree with it. */
const firstExpanded = (
  code: string
): { calls: CallExpansionModel[]; root: ExpressionNodeModel | null } => {
  const step = stepsOf(code).find((one) => 0 < one.callExpansions.length);
  return {
    calls: step?.callExpansions ?? [],
    root: step?.expression?.root ?? null,
  };
};

const allCalls = (code: string): CallExpansionModel[] =>
  stepsOf(code).flatMap((step) => step.callExpansions);

/** The first tree that pairs anything with a parameter. */
const firstTagged = (code: string): ExpressionNodeModel | null =>
  stepsOf(code)
    .map((step) => step.expression?.root ?? null)
    .find(
      (root) =>
        root !== null &&
        nodes(root).some((node) => typeof node.parameter === 'string')
    ) ?? null;

/** Every node of a tree, so a test can look for one without walking by hand. */
const nodes = (node: ExpressionNodeModel): ExpressionNodeModel[] => [
  node,
  ...node.children.flatMap(nodes),
];

const NESTED = `int twice(int n) {
  return n * 2;
}
int add(int a, int b) {
  return a + b;
}
int main(void) {
  int i = 3;
  int total = add(twice(i * 2), i + 1);
  return total;
}`;

describe('an argument stays with the call that binds it', () => {
  test('every argument is tagged with the parameter it fills', () => {
    const { root } = firstExpanded(NESTED);
    const tagged = nodes(root!)
      .filter((node) => typeof node.parameter === 'string')
      .map((node) => [node.text, node.parameter]);
    // Both of `add`'s arguments and the one `twice` takes, each under the
    // call operator that binds it rather than pulled out beside it.
    expect(tagged).toEqual([
      ['twice()', 'a'],
      ['*', 'n'],
      ['+', 'b'],
    ]);
  });

  test('a call view is rooted at the call, with its arguments under it', () => {
    const { calls } = firstExpanded(NESTED);
    expect(calls).toHaveLength(1);
    expect(calls[0].callee).toBe('twice()');
    expect(calls[0].parameters).toEqual(['n']);
    // Rooted at the call operator - not at the argument, which would separate
    // the argument from the thing that gives it its meaning.
    expect(calls[0].expression.root.text).toBe('twice()');
    expect(
      calls[0].expression.root.children.map((child) => [
        child.text,
        child.parameter,
      ])
    ).toEqual([['*', 'n']]);
  });

  test('a call with no computed argument gets no view of its own', () => {
    // `twice(i)` copies what `i` already holds, which the call tree and the
    // memory beside it both say.
    expect(
      allCalls(`int twice(int n) {
  return n * 2;
}
int main(void) {
  int i = 3;
  return twice(i) + twice(4);
}`)
    ).toEqual([]);
  });
});

describe('which calls the statement buries', () => {
  test('a call the statement is already about gets no second view', () => {
    // `int t = twice(i * 2);` is the call, give or take the `=`, so the
    // statement's own expansion is that call's view.
    const code = `int twice(int n) {
  return n * 2;
}
int main(void) {
  int i = 3;
  int total = twice(i * 2);
  return total;
}`;
    expect(allCalls(code)).toEqual([]);
    // It is still expanded and still tagged, inside the statement.
    expect(
      nodes(firstTagged(code)!).some((node) => node.parameter === 'n')
    ).toBe(true);
  });

  test('a call one operand deep does get one', () => {
    const { calls } = firstExpanded(`int twice(int n) {
  return n * 2;
}
int main(void) {
  int total = 0;
  int i = 3;
  total = total + twice(i * 2);
  return total;
}`);
    expect(calls.map((one) => one.callee)).toEqual(['twice()']);
  });

  test('a returned call is the statement, not something it buries', () => {
    expect(
      allCalls(`int twice(int n) {
  return n * 2;
}
int main(void) {
  int i = 3;
  return twice(i * 2);
}`)
    ).toEqual([]);
  });
});

describe('what a call view is worth', () => {
  test('operands hold what the frame holds going in', () => {
    const { calls } = firstExpanded(NESTED);
    const operands = nodes(calls[0].expression.root).map((node) => [
      node.text,
      node.value,
    ]);
    expect(operands).toContainEqual(['i', '3']);
  });

  test('a key is stable across the steps that draw the same call', () => {
    const keys = allCalls(`int twice(int n) {
  return n * 2;
}
int main(void) {
  int total = 0;
  for (int i = 0; i < 3; i++) {
    total = total + twice(i * 2);
  }
  return total;
}`).map((one) => one.key);
    // Three iterations reach the same call site; a reader who collapses that
    // section must not have it reopen under them on the next one.
    expect(1 < keys.length).toBe(true);
    expect(new Set(keys).size).toBe(1);
  });

  test('a library call has no parameter names and leaves them out', () => {
    const { calls, root } = firstExpanded(`#include <stdio.h>
int twice(int n) {
  return n * 2;
}
int main(void) {
  int i = 3;
  printf("%d\\n", twice(i * 2));
  return 0;
}`);
    expect(calls.map((one) => one.callee)).toEqual(['twice()']);
    // `printf` resolves to nothing without running the program, so its
    // arguments carry no parameter rather than a guessed one.
    const printf = nodes(root!).find((node) => node.text === 'printf()');
    expect(
      printf!.children.every((child) => typeof child.parameter === 'undefined')
    ).toBe(true);
  });
});

describe('the heading a call section carries', () => {
  const call = (over: Partial<CallExpansionModel>): CallExpansionModel => ({
    key: 'call-twice()-6-9',
    callee: 'twice()',
    parameters: ['n'],
    expression: {
      range: { begin: { x: 0, y: 6 }, end: { x: 5, y: 6 } },
      root: {
        key: 'expression-0',
        kind: 'operator',
        text: 'twice()',
        range: { begin: { x: 0, y: 6 }, end: { x: 5, y: 6 } },
        value: null,
        children: [],
      },
    },
    ...over,
  });

  test('names the callee and the parameters its arguments fill', () => {
    expect(callHeading(call({ callee: 'add()', parameters: ['a', 'b'] }))).toBe(
      'Call add(a, b)'
    );
  });

  test('names the callee alone when the parameters are not knowable', () => {
    expect(callHeading(call({ callee: 'printf()', parameters: [] }))).toBe(
      'Call printf()'
    );
  });
});
