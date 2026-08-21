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

interface StateWithExpression extends ExecState {
  plivetExpression?: ExpressionModel | null;
}

/** C's assignment operators (6.5.16), which `ConstructTrace` reads too. */
export const ASSIGNMENT = /^(?:=|\+=|-=|\*=|\/=|%=|<<=|>>=|&=|\|=|\^=)$/;

/**
 * Leaves a plain tree of the statement about to run on each execution
 * snapshot.
 *
 * It is the statement the editor is highlighting, expanded: the operators, the
 * operands under them, and what each name holds going in. It used to be the
 * statement that had just finished, numbered in evaluation order, which read
 * as a different program the moment a call suspended one - the caller's
 * half-evaluated assignment shown against a line inside the callee.
 *
 * Values recorded while the interpreter evaluates are kept for the statement
 * they belong to, so a statement suspended part-way through a call still shows
 * what it got before it stopped. What the operands hold going in is filled in
 * by `extractModel`: the execution state is only assembled at the end of the
 * step, and reading the frames from here would read them too early.
 */
export class ExpressionRecorder {
  private active: UniExpr | null = null;
  private values = new WeakMap<UniExpr, string>();

  capture(expr: UniExpr, value: unknown): void {
    if (this.active === null) {
      return;
    }
    this.values.set(expr, expressionValue(value));
  }

  beforeYield(state: ExecState, next: UniExpr): void {
    if (next !== this.active) {
      this.values = new WeakMap<UniExpr, string>();
    }
    this.active = next;
    this.attach(state);
  }

  finish(state: ExecState): void {
    // Nothing is about to run any more.
    this.active = null;
    this.values = new WeakMap<UniExpr, string>();
    this.attach(state);
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
  values: WeakMap<UniExpr, string>
): ExpressionModel {
  return {
    range: rangeOf(expression),
    root: nodeOf(expression, values, { value: 0 }),
  };
}

/**
 * What the interpreter recorded for a node, if it has run already. An operator
 * that has not run yet is worth nothing yet, and says so by staying empty.
 */
function valueOf(
  expression: UniExpr,
  values: WeakMap<UniExpr, string>
): string | null {
  const evaluated = values.get(expression);
  return typeof evaluated === 'undefined' ? null : evaluated;
}

function nodeOf(
  expression: UniExpr,
  values: WeakMap<UniExpr, string>,
  keys: { value: number }
): ExpressionNodeModel {
  if (expression instanceof UniVariableDec) {
    const definition = expression.variables.find(
      (item) => item.value !== null && containsExpandableOperator(item.value)
    );
    if (typeof definition !== 'undefined') {
      const left: ExpressionNodeModel = {
        key: `expression-${keys.value++}`,
        kind: 'operand',
        text: definition.name,
        // The declarator, which is where the name is written.
        range: rangeOf(definition),
        value: null,
        children: [],
      };
      return {
        key: `expression-${keys.value++}`,
        kind: 'assignment',
        text: '=',
        range: rangeOf(expression),
        value: valueOf(expression, values),
        children: [left, nodeOf(definition.value, values, keys)],
      };
    }
  }

  const children = childrenOf(expression).map((child) =>
    nodeOf(child, values, keys)
  );
  return {
    key: `expression-${keys.value++}`,
    kind: kindOf(expression, children.length),
    text: expressionText(expression),
    range: rangeOf(expression),
    value: valueOf(expression, values),
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
    return `${calleeName(expression.methodName)}()`;
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

/**
 * The name a call goes through.
 *
 * A call through a function pointer arrives as `(*ops[1])(7, 3)`, whose callee
 * is the dereference rather than a name, so naming it means reaching past the
 * operators to the pointer itself. `outline.ts` needs the same reach and has
 * its own copy: it lives in the interpreter's chunk, and importing it here
 * would pull the whole outline walk into the core one.
 */
function calleeName(node: unknown): string {
  if (node === null || typeof node !== 'object') {
    return '';
  }
  const named = node as { name?: unknown };
  if (typeof named.name === 'string' && named.name !== '') {
    return named.name;
  }
  const parts = node as Record<string, unknown>;
  for (const field of ['expr', 'left', 'receiver', 'methodName']) {
    const found = calleeName(parts[field]);
    if (found !== '') {
      return found;
    }
  }
  return '';
}

function containsExpandableOperator(expression: UniExpr): boolean {
  if (expression instanceof UniTernaryOp) {
    return true;
  }
  // A call earns a window for its arguments alone. C passes by value, and
  // `twice(i)` says nothing on screen about the copy it makes of `i` - which
  // is the misconception the expansion exists to answer, and it is no less
  // true of `twice(3)`. Only the arguments make a picture, so a call that
  // takes none is still left out.
  if (expression instanceof UniMethodCall && 0 < expression.args.length) {
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

/**
 * A value as a reader would read it. Shared with `ConstructTrace`: the two
 * surfaces report the same evaluations, and a value that reads one way on the
 * canvas and another in a tooltip is two answers to one question.
 */
export function expressionValue(value: unknown): string {
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
