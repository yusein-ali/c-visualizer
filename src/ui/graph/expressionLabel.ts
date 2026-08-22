import { ExpressionNodeModel } from '../../core';

/**
 * The primary label in one expression box. The current value is deliberately
 * absent: the renderer gives it a labeled visual region instead of ambiguous
 * shorthand such as `= 0`. Assignment targets and `=` are separate nodes, so
 * the three-part `target | = | value` sequence still reads like the source.
 */
export const expressionNodeLabel = (node: ExpressionNodeModel): string =>
  node.text;
