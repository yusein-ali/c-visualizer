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
  CallExpansionModel,
  CodeRangeModel,
  ExpressionModel,
  ExpressionNodeKind,
  ExpressionNodeModel,
} from '../core/model';

interface StateWithExpression extends ExecState {
  plivetExpression?: ExpressionModel | null;
  plivetCallExpansions?: CallExpansionModel[];
}

/**
 * The parameters a call's callee declares, in order.
 *
 * The recorder cannot work this out: resolving a name to a definition needs a
 * scope, and the engine is the thing that has one. It is asked before the call
 * has begun, so a call through a pointer answers with nothing rather than by
 * running the expression to find out - and an argument view then names its
 * position alone, which is the honest answer at that point.
 */
export type ParameterLookup = (call: UniMethodCall) => string[];

/** C's assignment operators (6.5.16), which `ConstructTrace` reads too. */
export const ASSIGNMENT = /^(?:=|\+=|-=|\*=|\/=|%=|<<=|>>=|&=|\|=|\^=)$/;

/** The mapper represents postfix updates as binary nodes with no right side. */
const POSTFIX_UPDATE = /^(?:\+\+|--)$/;

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
  private parameters: ParameterLookup = () => [];

  capture(expr: UniExpr, value: unknown): void {
    if (this.active === null) {
      return;
    }
    this.values.set(expr, expressionValue(value));
  }

  beforeYield(
    state: ExecState,
    next: UniExpr,
    parameters: ParameterLookup = () => []
  ): void {
    if (next !== this.active) {
      this.values = new WeakMap<UniExpr, string>();
    }
    this.active = next;
    this.parameters = parameters;
    this.attach(state);
  }

  finish(state: ExecState): void {
    // Nothing is about to run any more.
    this.active = null;
    this.values = new WeakMap<UniExpr, string>();
    this.attach(state);
  }

  private attach(state: ExecState): void {
    const target = state as StateWithExpression;
    if (this.active === null || !containsExpandableOperator(this.active)) {
      target.plivetExpression = null;
      target.plivetCallExpansions = [];
      return;
    }
    // One counter for the whole step, so no two nodes drawn on the canvas at
    // the same time can be told apart only by which tree they came from.
    const keys = { value: 0 };
    target.plivetExpression = expressionOf(
      this.active,
      this.values,
      keys,
      this.parameters
    );
    target.plivetCallExpansions = callExpansionsOf(
      this.active,
      this.values,
      this.parameters,
      keys
    );
  }
}

export function expressionTraceOf(state: ExecState): ExpressionModel | null {
  const expression = (state as StateWithExpression).plivetExpression;
  return typeof expression === 'undefined' ? null : expression;
}

/** The calls in the statement about to run that pass a computed argument. */
export function callExpansionsOfState(state: ExecState): CallExpansionModel[] {
  return (state as StateWithExpression).plivetCallExpansions ?? [];
}

/**
 * Every call worth a view of its own, outermost first.
 *
 * A call earns one when at least one of its arguments is computed. `twice(i)`
 * does not: the call tree and the memory beside it already say what `i` holds,
 * and a section for every call regardless would bury the ones that have
 * something to show.
 *
 * Nested calls each get their own, because each binds its own parameters -
 * `f(g(x * 2))` has one thing to say about what `f` copies and another about
 * what `g` does. What it never does is split one call's arguments across
 * views: they are what a single call operator binds, positionally and at
 * once, and apart from that operator an argument is just an expression that
 * happens to be written inside some parentheses.
 *
 * A call the main expansion already shows on its own is left out. `f(x * 2);`
 * and `int t = f(x * 2);` are the call, give or take the `=` and the name
 * being written to, so the statement's tree is that call's view already and a
 * section repeating it is noise rather than emphasis. What earns one is a call
 * the statement buries - `total = total + twice(a * 2 + 1)`, where the call is
 * one operand of one operator of an assignment.
 */
function callExpansionsOf(
  expression: UniExpr,
  values: WeakMap<UniExpr, string>,
  parameters: ParameterLookup,
  keys: { value: number }
): CallExpansionModel[] {
  const found: CallExpansionModel[] = [];
  /**
   * `spine` is true while nothing but a `return`, an assignment or a
   * declaration stands between this node and the root - the punctuation of a
   * statement rather than a computation in it. A call reached that way is what
   * the statement does, and the main expansion has already drawn it.
   */
  const visit = (node: UniExpr, spine: boolean): void => {
    if (
      node instanceof UniMethodCall &&
      !spine &&
      node.args.some((argument) => 0 < childrenOf(argument).length)
    ) {
      const at = rangeOf(node).begin;
      const callee = `${calleeName(node.methodName)}()`;
      found.push({
        key: `call-${callee}-${at.y}-${at.x}`,
        callee,
        parameters: parameters(node),
        expression: expressionOf(node, values, keys, parameters),
      });
    }
    // `childrenOf` does not descend a declaration - `nodeOf` reaches its
    // initialiser itself, for the `=` it draws - so the walk does it here.
    // Without this `int total = twice(a * 2);` would find no call at all.
    if (node instanceof UniVariableDec) {
      for (const definition of node.variables) {
        if (definition.value !== null) {
          visit(definition.value, spine);
        }
      }
      return;
    }
    const children = childrenOf(node);
    for (const child of children) {
      // A `return`'s value and an assignment's right side carry the spine on;
      // an operand of anything else is a computation, and what it contains is
      // buried far enough to be worth pulling out.
      const carries =
        spine &&
        (node instanceof UniReturn ||
          (node instanceof UniBinOp &&
            ASSIGNMENT.test(node.operator) &&
            child === node.right));
      visit(child, carries);
    }
  };
  visit(expression, true);
  return found;
}

function expressionOf(
  expression: UniExpr,
  values: WeakMap<UniExpr, string>,
  keys: { value: number },
  parameters: ParameterLookup
): ExpressionModel {
  return {
    range: rangeOf(expression),
    root: nodeOf(expression, values, keys, parameters),
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
  keys: { value: number },
  parameters: ParameterLookup
): ExpressionNodeModel {
  if (expression instanceof UniVariableDec) {
    const definition = expression.variables.find((item) => item.value !== null);
    if (typeof definition !== 'undefined') {
      const key = `expression-${keys.value++}`;
      // A declarator has no identifier expression of its own, so make the
      // target leaf that a regular assignment gets from its left operand.
      // Keeping it separate gives every assignment the same target, operator,
      // value sequence on the canvas.
      const target: ExpressionNodeModel = {
        key: `expression-${keys.value++}`,
        kind: 'operand',
        text: definition.name,
        range: rangeOf(expression),
        value: null,
        children: [],
      };
      return {
        key,
        kind: 'assignment',
        text: '=',
        range: rangeOf(expression),
        value: valueOf(expression, values),
        children: [target, nodeOf(definition.value, values, keys, parameters)],
      };
    }
  }

  const children = childrenOf(expression).map((child) =>
    nodeOf(child, values, keys, parameters)
  );
  // An argument is the one node whose meaning comes from somewhere other than
  // the tree: it is a value about to be copied into a named object, and the
  // name is in the callee's declaration rather than at the call.
  if (expression instanceof UniMethodCall) {
    const names = parameters(expression);
    children.forEach((child, index) => {
      const name = names[index];
      if (typeof name === 'string' && name !== '') {
        child.parameter = name;
      }
    });
  }
  const kind = kindOf(expression, children.length);
  const text = expressionText(expression);
  return {
    key: `expression-${keys.value++}`,
    kind,
    text,
    range: rangeOf(expression),
    value: valueOf(expression, values),
    children,
  };
}

function childrenOf(expression: UniExpr): UniExpr[] {
  if (expression instanceof UniBinOp) {
    return POSTFIX_UPDATE.test(expression.operator)
      ? [expression.left]
      : [expression.left, expression.right];
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
  // Every operator earns one, `=` included. A plain assignment used to be left
  // out for having nothing to expand, which is only true of the tree: three
  // boxes say which object is written, the operation, and the value that goes
  // into it, and a reader stepping through a program should not have the expansion
  // appear and disappear according to how much arithmetic the line happens to
  // contain.
  if (expression instanceof UniBinOp) {
    return true;
  }
  if (expression instanceof UniVariableDec) {
    // A declaration with an initialiser is that same picture, with the object
    // coming into existence as it is written.
    return expression.variables.some((definition) => definition.value !== null);
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
