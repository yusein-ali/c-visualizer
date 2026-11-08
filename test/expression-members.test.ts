import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import {
  ExpressionModel,
  ExpressionNodeModel,
  extractModel,
} from '../src/core';

/*
 * The expression tree fills each operand with what it holds going in. It used
 * to look every leaf up by its text, so the member name in `pt.x` showed the
 * value of whatever variable called `x` was in scope.
 */

const treeBefore = (code: string, line: number): ExpressionNodeModel => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  try {
    const found: ExpressionModel[] = [];
    const record = (state: Parameters<typeof extractModel>[0]) => {
      const expression = extractModel(state).expression;
      if (expression !== null && expression.range.begin.y === line) {
        found.push(expression);
      }
    };
    record(interpreter.startStepExecution(code));
    for (let steps = 0; interpreter.isStepExecutionRunning() && steps < 200; ) {
      record(interpreter.stepExecute());
      steps += 1;
    }
    expect(found.length).toBeGreaterThan(0);
    return found[0].root;
  } finally {
    console.log = log;
  }
};

const nodes = (root: ExpressionNodeModel): ExpressionNodeModel[] => [
  root,
  ...root.children.flatMap(nodes),
];

describe('member accesses in the expression tree', () => {
  const code = `struct Inner { int x; };
struct P { int x; int y; struct Inner in; };
int main(void) {
  int x = 99;
  struct P pt;
  pt.x = 1;
  pt.in.x = 5;
  pt.y = pt.x + x + pt.in.x;
  return 0;
}
`;

  it('fills a member by its path, and leaves the member name alone', () => {
    const root = treeBefore(code, 8);
    const accesses = nodes(root).filter((node) => node.text === '.');
    const pathOf = (node: ExpressionNodeModel): string =>
      node.text === '.'
        ? `${pathOf(node.children[0])}.${node.children[1].text}`
        : node.text;
    const value = (path: string): string | null | undefined =>
      accesses.find((node) => pathOf(node) === path)?.value;
    // `pt.x` is 1 - not the 99 of the variable called `x`.
    expect(value('pt.x')).toBe('1');
    expect(value('pt.in.x')).toBe('5');
    for (const access of accesses) {
      expect(access.children[1].value).toBeNull();
    }
    // The variable `x` itself still shows its own value.
    const variable = nodes(root).find(
      (node) =>
        node.kind === 'operand' &&
        node.text === 'x' &&
        !accesses.some((access) => access.children[1] === node)
    );
    expect(variable?.value).toBe('99');
  });

  it('leaves a member reached through a pointer unfilled', () => {
    const root = treeBefore(
      `struct P { int x; };
int main(void) {
  int x = 7;
  struct P pt;
  struct P *p = &pt;
  pt.x = 3;
  int y = p->x + x;
  return 0;
}
`,
      7
    );
    const arrow = nodes(root).find((node) => node.text === '->');
    expect(arrow?.children[1].value).toBeNull();
    expect(arrow?.value).toBeNull();
  });
});
