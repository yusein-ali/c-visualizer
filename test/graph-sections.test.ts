import { ExpressionModel } from '../src/core';
import {
  expressionSectionIsCollapsed,
  leftAlignedLabel,
  wrappedTextHeight,
} from '../src/ui/graph/PlivetGraph';

describe('the textual canvas sections', () => {
  it('overrides both centered JointJS coordinates', () => {
    expect(leftAlignedLabel(10, 38)).toEqual({
      x: 10,
      y: 19,
      textAnchor: 'start',
      textVerticalAnchor: 'middle',
    });
  });

  it('gives every explicit fact line its own vertical space', () => {
    expect(wrappedTextHeight('one\ntwo\nthree\nfour\nfive', 480, 58)).toBe(102);
  });

  it('collapses the expression section while there is nothing to expand', () => {
    const expression = {} as ExpressionModel;

    expect(expressionSectionIsCollapsed(null, false)).toBe(true);
    expect(expressionSectionIsCollapsed(expression, false)).toBe(false);
    expect(expressionSectionIsCollapsed(expression, true)).toBe(true);
  });
});
