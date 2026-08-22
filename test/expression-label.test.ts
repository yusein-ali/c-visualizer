import { ExpressionNodeModel } from '../src/core';
import { expressionNodeLabel } from '../src/ui/graph/expressionLabel';

const node = (
  changes: Partial<ExpressionNodeModel> = {}
): ExpressionNodeModel => ({
  key: 'expression-0',
  kind: 'operand',
  text: '3',
  range: {
    begin: { x: 4, y: 1 },
    end: { x: 5, y: 1 },
  },
  value: null,
  children: [],
  ...changes,
});

describe('expression box labels', () => {
  it('keeps the assignment operator in its own box', () => {
    const assignment = node({
      kind: 'assignment',
      text: '=',
      value: '3',
      children: [node({ text: 'result' }), node()],
    });

    expect(expressionNodeLabel(assignment)).toBe('=');
  });

  it('leaves an ordinary operator value for its separate visual region', () => {
    expect(expressionNodeLabel(node({ text: '+', value: '3' }))).toBe('+');
  });

  it('keeps a computed assignment operator as one equals block', () => {
    expect(
      expressionNodeLabel(node({ kind: 'assignment', text: '=', value: '3' }))
    ).toBe('=');
  });

  it('does not append parameter plumbing to an argument label', () => {
    expect(expressionNodeLabel(node({ text: 'i', parameter: 'n' }))).toBe('i');
  });
});
