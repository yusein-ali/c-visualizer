import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { UniArray } from 'unicoen.ts/dist/node/UniArray';
import { UniBinOp } from 'unicoen.ts/dist/node/UniBinOp';
import { UniCast } from 'unicoen.ts/dist/node/UniCast';
import { UniExpr } from 'unicoen.ts/dist/node/UniExpr';
import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniIf } from 'unicoen.ts/dist/node/UniIf';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniReturn } from 'unicoen.ts/dist/node/UniReturn';
import { UniTernaryOp } from 'unicoen.ts/dist/node/UniTernaryOp';
import { UniUnaryOp } from 'unicoen.ts/dist/node/UniUnaryOp';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniWhile } from 'unicoen.ts/dist/node/UniWhile';
import type {
  CodeRangeModel,
  ExpressionModel,
  ExpressionNodeKind,
  ExpressionNodeModel,
} from '../core/model';

interface Evaluated {
  order: number;
  value: string;
}

interface StateWithExpression extends ExecState {
  plivetExpression?: ExpressionModel | null;
}

const ASSIGNMENT = /^(?:=|\+=|-=|\*=|\/=|%=|<<=|>>=|&=|\|=|\^=)$/;

/**
 * Records values while the interpreter recursively evaluates an expression,
 * then leaves only a plain tree on the execution snapshot at a step boundary.
 */
export class ExpressionRecorder {
  private active: UniExpr | null = null;
  private values = new WeakMap<UniExpr, Evaluated>();
  private order = 0;

  capture(expr: UniExpr, value: unknown): void {
    if (this.active === null) {
      return;
    }
    this.values.set(expr, {
      order: this.order,
      value: expressionValue(value),
    });
    this.order += 1;
  }

  beforeYield(state: ExecState, next: UniExpr): void {
    this.attach(state);
    this.active = next;
    this.values = new WeakMap<UniExpr, Evaluated>();
    this.order = 0;
  }

  finish(state: ExecState): void {
    this.attach(state);
    this.active = null;
    this.values = new WeakMap<UniExpr, Evaluated>();
    this.order = 0;
  }

  private attach(state: ExecState): void {
    (state as StateWithExpression).plivetExpression =
      this.active === null || !containsExpandableOperator(this.active)
        ? null
        : expressionOf(this.active, this.values);
  }
}

export function expressionTraceOf(state: ExecState): ExpressionModel | null {
  const expression = (state as StateWithExpression).plivetExpression;
  return typeof expression === 'undefined' ? null : expression;
}

function expressionOf(
  expression: UniExpr,
  values: WeakMap<UniExpr, Evaluated>
): ExpressionModel {
  return {
    range: rangeOf(expression),
    root: nodeOf(expression, values, { value: 0 }),
  };
}

function nodeOf(
  expression: UniExpr,
  values: WeakMap<UniExpr, Evaluated>,
  keys: { value: number }
): ExpressionNodeModel {
  if (expression instanceof UniVariableDec) {
    const definition = expression.variables.find(
      (item) => item.value !== null && containsExpandableOperator(item.value)
    );
    if (typeof definition !== 'undefined') {
      const evaluated = values.get(expression);
      const left: ExpressionNodeModel = {
        key: `expression-${keys.value++}`,
        kind: 'operand',
        text: definition.name,
        value: definition.name,
        order: -1,
        children: [],
      };
      return {
        key: `expression-${keys.value++}`,
        kind: 'assignment',
        text: '=',
        value: typeof evaluated === 'undefined' ? null : evaluated.value,
        order: typeof evaluated === 'undefined' ? -1 : evaluated.order,
        children: [left, nodeOf(definition.value, values, keys)],
      };
    }
  }

  const children = childrenOf(expression).map((child) =>
    nodeOf(child, values, keys)
  );
  const evaluated = values.get(expression);
  return {
    key: `expression-${keys.value++}`,
    kind: kindOf(expression, children.length),
    text: expressionText(expression),
    value: typeof evaluated === 'undefined' ? null : evaluated.value,
    order: typeof evaluated === 'undefined' ? -1 : evaluated.order,
    children,
  };
}

function childrenOf(expression: UniExpr): UniExpr[] {
  if (expression instanceof UniBinOp) {
    return [expression.left, expression.right];
  }
  if (expression instanceof UniTernaryOp) {
    return [expression.cond, expression.trueExpr, expression.falseExpr];
  }
  if (expression instanceof UniUnaryOp) {
    return [expression.expr];
  }
  if (expression instanceof UniCast) {
    return [expression.value];
  }
  if (expression instanceof UniArray) {
    return expression.items;
  }
  if (expression instanceof UniMethodCall) {
    return expression.args;
  }
  if (expression instanceof UniReturn) {
    return expression.value === null ? [] : [expression.value];
  }
  if (expression instanceof UniIf || expression instanceof UniWhile) {
    return [expression.cond];
  }
  return [];
}

function kindOf(expression: UniExpr, childCount: number): ExpressionNodeKind {
  if (expression instanceof UniBinOp && ASSIGNMENT.test(expression.operator)) {
    return 'assignment';
  }
  return childCount === 0 ? 'operand' : 'operator';
}

function expressionText(expression: UniExpr): string {
  if (expression instanceof UniBinOp || expression instanceof UniUnaryOp) {
    return expression.operator;
  }
  if (expression instanceof UniTernaryOp) {
    return '?:';
  }
  if (expression instanceof UniCast) {
    return `(${expression.type})`;
  }
  if (expression instanceof UniMethodCall) {
    return `${expression.methodName.name}()`;
  }
  if (expression instanceof UniReturn) {
    return 'return';
  }
  if (expression instanceof UniIf) {
    return 'if';
  }
  if (expression instanceof UniWhile) {
    return 'while';
  }
  if (expression instanceof UniArray) {
    return '{}';
  }
  if (expression instanceof UniIdent) {
    return expression.name;
  }
  const literal = (expression as unknown as { value?: unknown }).value;
  if (typeof literal !== 'undefined') {
    return typeof literal === 'string'
      ? JSON.stringify(literal)
      : String(literal);
  }
  return expression.constructor.name.replace(/^Uni/, '');
}

function containsExpandableOperator(expression: UniExpr): boolean {
  if (expression instanceof UniTernaryOp) {
    return true;
  }
  if (
    expression instanceof UniBinOp &&
    (!ASSIGNMENT.test(expression.operator) || expression.operator !== '=')
  ) {
    return true;
  }
  if (expression instanceof UniVariableDec) {
    return expression.variables.some(
      (definition) =>
        definition.value !== null &&
        containsExpandableOperator(definition.value)
    );
  }
  return childrenOf(expression).some(containsExpandableOperator);
}

function rangeOf(expression: UniExpr): CodeRangeModel {
  const range = expression.codeRange;
  return {
    begin: { x: range.begin.x, y: range.begin.y },
    end: { x: range.end.x, y: range.end.y },
  };
}

function expressionValue(value: unknown): string {
  if (typeof value === 'undefined') {
    return 'undefined';
  }
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(expressionValue).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const primitive = (value as { valueOf(): unknown }).valueOf();
    return primitive === value ? value.constructor.name : String(primitive);
  }
  return String(value);
}
