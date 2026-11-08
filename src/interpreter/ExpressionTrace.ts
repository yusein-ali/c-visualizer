import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import type { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import { UniArray } from 'unicoen.ts/dist/node/UniArray';
import { UniBinOp } from 'unicoen.ts/dist/node/UniBinOp';
import { UniBoolLiteral } from 'unicoen.ts/dist/node/UniBoolLiteral';
import { UniCast } from 'unicoen.ts/dist/node/UniCast';
import { UniCharacterLiteral } from 'unicoen.ts/dist/node/UniCharacterLiteral';
import { UniDoubleLiteral } from 'unicoen.ts/dist/node/UniDoubleLiteral';
import { UniExpr } from 'unicoen.ts/dist/node/UniExpr';
import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniIntLiteral } from 'unicoen.ts/dist/node/UniIntLiteral';
import { UniIf } from 'unicoen.ts/dist/node/UniIf';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniReturn } from 'unicoen.ts/dist/node/UniReturn';
import { UniStringLiteral } from 'unicoen.ts/dist/node/UniStringLiteral';
import { UniTernaryOp } from 'unicoen.ts/dist/node/UniTernaryOp';
import { UniUnaryOp } from 'unicoen.ts/dist/node/UniUnaryOp';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniVariableDef } from 'unicoen.ts/dist/node/UniVariableDef';
import { UniWhile } from 'unicoen.ts/dist/node/UniWhile';
import type {
  CallExpansionModel,
  CodeRangeModel,
  ExpressionModel,
  ExpressionNodeKind,
  ExpressionNodeModel,
} from '../core/model';
import {
  addressType,
  canonicalType,
  commonType,
  conversionText,
  convertedValue,
  cSpelling,
  elementType,
  isArithmeticType,
  isIntegerType,
  isPointerType,
  literalType,
  promotedType,
} from './ExpressionTypes';
import { decodedText } from './Escapes';
import { literalSpelling } from './LiteralSpelling';
import { declarationInfoOf, displayTypeOf } from './RuntimeTypeInfo';

/**
 * How a node's type is found once the frames can be read.
 *
 * The tree is built when the statement is about to run, and the frames are
 * only assembled at the end of the step - reading a name's type then would
 * miss what the previous statement declared and, on a call's first line, the
 * callee's parameters. So the tree is built with a rule per node, and the
 * rules are applied by `expressionTraceOf`, on the finished state, which is
 * when `extractModel` reads the operands' values as well.
 *
 * Plain data, like the rest of the tree: it travels on the execution state,
 * which is cloned for the history.
 */
type TypeRule =
  /** A variable, or a member path such as `pt.x`. */
  | { kind: 'name'; name: string }
  /** A type as the source writes it: a cast's, a declaration's. */
  | { kind: 'written'; spelling: string }
  /** Known from the tree alone: a constant's type, or nothing at all. */
  | { kind: 'fixed'; type: string | null }
  | { kind: 'unary'; operator: string }
  | { kind: 'binary'; operator: string }
  | { kind: 'ternary' }
  /** The `=` a declaration with an initialiser is drawn as. */
  | { kind: 'declaration'; spelling: string | null; list: boolean };

/** A node as it is built, before its type and conversions are worked out. */
interface DraftNode extends Omit<ExpressionNodeModel, 'children' | 'type'> {
  rule: TypeRule;
  /** Its value as a constant expression, where it is one. */
  constant: string | null;
  children: DraftNode[];
}

interface ExpressionDraft {
  range: CodeRangeModel;
  root: DraftNode;
}

interface CallExpansionDraft extends Omit<CallExpansionModel, 'expression'> {
  expression: ExpressionDraft;
}

interface StateWithExpression extends ExecState {
  plivetExpression?: ExpressionDraft | null;
  plivetCallExpansions?: CallExpansionDraft[];
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

/** The C types the tree can name, read from a finished execution state. */
export interface TypeLookup {
  /** A name in scope, or a member path such as `pt.x`; null when unknown. */
  variable(name: string): string | null;
  /** A type as the source writes it, typedefs resolved, canonically spelled. */
  written(spelling: string): string;
}

/** Everything the tree is built from besides the expression itself. */
interface TraceContext {
  values: WeakMap<UniExpr, string>;
  keys: { value: number };
  parameters: ParameterLookup;
}

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
 * by `extractModel`, and their types by `expressionTraceOf`: the execution
 * state is only assembled at the end of the step, and reading the frames from
 * here would read them too early.
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
    const context: TraceContext = {
      values: this.values,
      keys: { value: 0 },
      parameters: this.parameters,
    };
    target.plivetExpression = expressionOf(this.active, context);
    target.plivetCallExpansions = callExpansionsOf(this.active, context);
  }
}

/**
 * The statement about to run as a tree, typed against the finished state,
 * with C's implicit conversions drawn where they happen.
 */
export function expressionTraceOf(state: ExecState): ExpressionModel | null {
  const draft = (state as StateWithExpression).plivetExpression;
  return typeof draft === 'undefined' || draft === null
    ? null
    : typedExpression(draft, typesIn(state));
}

/** The calls in the statement about to run that pass a computed argument. */
export function callExpansionsOfState(state: ExecState): CallExpansionModel[] {
  const drafts = (state as StateWithExpression).plivetCallExpansions ?? [];
  if (drafts.length === 0) {
    return [];
  }
  const types = typesIn(state);
  return drafts.map((call) => ({
    ...call,
    expression: typedExpression(call.expression, types),
  }));
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
  context: TraceContext
): CallExpansionDraft[] {
  const found: CallExpansionDraft[] = [];
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
        parameters: context.parameters(node),
        expression: expressionOf(node, context),
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
  context: TraceContext
): ExpressionDraft {
  return {
    range: rangeOf(expression),
    root: nodeOf(expression, context),
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

function nodeOf(expression: UniExpr, context: TraceContext): DraftNode {
  const { values, keys, parameters } = context;
  if (expression instanceof UniVariableDec) {
    const definition = expression.variables.find((item) => item.value !== null);
    if (typeof definition !== 'undefined') {
      const key = `expression-${keys.value++}`;
      const spelling = declaredType(expression, definition);
      // A declarator has no identifier expression of its own, so make the
      // target leaf that a regular assignment gets from its left operand.
      // Keeping it separate gives every assignment the same target, operator,
      // value sequence on the canvas.
      const target: DraftNode = {
        key: `expression-${keys.value++}`,
        kind: 'operand',
        text: definition.name,
        range: rangeOf(expression),
        value: null,
        rule:
          spelling === null
            ? { kind: 'fixed', type: null }
            : { kind: 'written', spelling },
        constant: null,
        children: [],
      };
      return {
        key,
        kind: 'assignment',
        text: '=',
        range: rangeOf(expression),
        value: valueOf(expression, values),
        // An initialiser list initialises each member to its own type; the
        // braces themselves are converted to nothing.
        rule: {
          kind: 'declaration',
          spelling,
          list: definition.value instanceof UniArray,
        },
        constant: null,
        children: [target, nodeOf(definition.value, context)],
      };
    }
  }

  const children = childrenOf(expression).map((child) =>
    nodeOf(child, context)
  );
  // The right side of `.` and `->` is a member's name, not a variable, and
  // whatever an object of that name in scope has for a type is not its type.
  if (
    expression instanceof UniBinOp &&
    (expression.operator === '.' || expression.operator === '->') &&
    typeof children[1] !== 'undefined'
  ) {
    children[1].rule = { kind: 'fixed', type: null };
  }
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
  const evaluated = valueOf(expression, values);
  return {
    key: `expression-${keys.value++}`,
    kind,
    text,
    range: rangeOf(expression),
    // A constant is its own value; saying so in the spelling it was written in
    // keeps `2.0` from reading `2` once it has been evaluated, and `'a'` from
    // repeating itself as `a`.
    value:
      evaluated !== null &&
      (literalSpelling(expression) !== null ||
        expression instanceof UniCharacterLiteral)
        ? text
        : evaluated,
    rule: ruleOf(expression),
    constant: constantOf(expression),
    children,
  };
}

/** How the type of the node built from this expression is found. */
function ruleOf(expression: UniExpr): TypeRule {
  if (expression instanceof UniIdent) {
    return { kind: 'name', name: expression.name };
  }
  if (
    expression instanceof UniIntLiteral ||
    expression instanceof UniDoubleLiteral
  ) {
    return {
      kind: 'fixed',
      type: literalType(
        literalSpelling(expression) ?? String(expression.value),
        expression instanceof UniDoubleLiteral,
        expression.value
      ),
    };
  }
  // A character constant is an `int` in C (6.4.4.4p10), and so is `true`.
  if (
    expression instanceof UniCharacterLiteral ||
    expression instanceof UniBoolLiteral
  ) {
    return { kind: 'fixed', type: 'int' };
  }
  if (expression instanceof UniStringLiteral) {
    return { kind: 'fixed', type: 'char *' };
  }
  if (expression instanceof UniCast) {
    return { kind: 'written', spelling: cSpelling(expression.type) };
  }
  if (expression instanceof UniUnaryOp) {
    return { kind: 'unary', operator: expression.operator };
  }
  if (expression instanceof UniTernaryOp) {
    return { kind: 'ternary' };
  }
  if (expression instanceof UniBinOp) {
    if (expression.operator === '.') {
      const path = memberPath(expression);
      return path === null
        ? { kind: 'fixed', type: null }
        : { kind: 'name', name: path };
    }
    return { kind: 'binary', operator: expression.operator };
  }
  return { kind: 'fixed', type: null };
}

/** The member path `a.b` names, or null for anything but plain names. */
function memberPath(expression: UniExpr): string | null {
  if (expression instanceof UniIdent) {
    return expression.name;
  }
  if (
    expression instanceof UniBinOp &&
    expression.operator === '.' &&
    expression.right instanceof UniIdent
  ) {
    const parent = memberPath(expression.left);
    return parent === null ? null : `${parent}.${expression.right.name}`;
  }
  return null;
}

/**
 * The value of a constant expression simple enough to read off the tree - a
 * number, a character, or one of those negated - as decimal text.
 */
function constantOf(expression: UniExpr | null | undefined): string | null {
  if (
    expression instanceof UniIntLiteral ||
    expression instanceof UniDoubleLiteral
  ) {
    return Number.isFinite(expression.value) ? String(expression.value) : null;
  }
  if (expression instanceof UniCharacterLiteral) {
    // Decoded the way the engine decodes it, octal and hexadecimal included.
    const text = decodedText(String(expression.value));
    return text.length === 1 ? String(text.charCodeAt(0)) : null;
  }
  if (
    expression instanceof UniUnaryOp &&
    (expression.operator === '-' || expression.operator === '+')
  ) {
    const inner = constantOf(expression.expr);
    if (inner === null || expression.operator === '+' || inner === '0') {
      return inner;
    }
    return inner.startsWith('-') ? inner.slice(1) : `-${inner}`;
  }
  return null;
}

/** The type a declaration gives the object it declares, as written. */
function declaredType(
  declaration: UniVariableDec,
  definition: UniVariableDef
): string | null {
  if (typeof declaration.type !== 'string' || declaration.type === '') {
    return null;
  }
  // The mapper leaves a pointer declarator's stars on the name: `*p`.
  const stars = (/^\**/.exec(definition.name) ?? [''])[0];
  const suffix =
    typeof definition.typeSuffix === 'string' ? definition.typeSuffix : '';
  return `${declaration.type}${stars}${suffix}`;
}

function typedExpression(
  draft: ExpressionDraft,
  types: TypeLookup
): ExpressionModel {
  return { range: draft.range, root: typedNode(draft.root, types) };
}

/**
 * A drafted node with its type, and an implicit conversion over each child
 * that C converts before using it.
 */
function typedNode(draft: DraftNode, types: TypeLookup): ExpressionNodeModel {
  const children = draft.children.map((child) => typedNode(child, types));
  const typing = typingOf(draft.rule, children, types);
  const node: ExpressionNodeModel = {
    key: draft.key,
    kind: draft.kind,
    text: draft.text,
    range: draft.range,
    value: draft.value,
    children: children.map((child, index) =>
      converted(
        child,
        typing.operands[index] ?? null,
        draft.children[index].constant
      )
    ),
  };
  if (typing.type !== null) {
    node.type = typing.type;
  }
  if (typeof draft.parameter !== 'undefined') {
    node.parameter = draft.parameter;
  }
  return node;
}

/**
 * The node with an implicit conversion over it, where C converts it: both
 * types are arithmetic, both are known, and they differ. Anything else - a
 * pointer, an aggregate, an operand of unknown type - is left alone rather
 * than guessed at.
 *
 * The conversion is worth what its operand is worth, converted. A constant's
 * worth is known before the statement runs, so `char c = 300;` says `44`
 * from the start; a name's is filled in by `extractModel`, with the rest of
 * the operands' values.
 */
function converted(
  node: ExpressionNodeModel,
  to: string | null,
  constant: string | null
): ExpressionNodeModel {
  const from = node.type ?? null;
  if (
    to === null ||
    from === null ||
    from === to ||
    !isArithmeticType(from) ||
    !isArithmeticType(to)
  ) {
    return node;
  }
  // The argument a call copies is the converted value, so the parameter it
  // initialises moves up to the conversion.
  const { parameter, ...operand } = node;
  const conversion: ExpressionNodeModel = {
    // One conversion at most stands over a node, so its key can be the
    // node's own, marked.
    key: `${node.key}-conversion`,
    kind: 'conversion',
    text: conversionText(from, to),
    range: node.range,
    value: convertedValue(node.value ?? constant, from, to),
    type: to,
    children: [operand],
  };
  if (typeof parameter !== 'undefined') {
    conversion.parameter = parameter;
  }
  return conversion;
}

/**
 * A conversion's value from its operand's, for `extractModel`, which fills in
 * what the names hold after the tree is built.
 */
export function conversionValueOf(node: ExpressionNodeModel): string | null {
  const operand = node.children[0];
  if (
    node.value !== null ||
    node.kind !== 'conversion' ||
    typeof operand === 'undefined' ||
    typeof operand.type === 'undefined' ||
    typeof node.type === 'undefined'
  ) {
    return node.value;
  }
  return convertedValue(operand.value, operand.type, node.type);
}

interface Typing {
  /** What the node evaluates to, or null when that is not known. */
  type: string | null;
  /** What each child is converted to, or null where it is not converted. */
  operands: (string | null)[];
}

/** An array operand is used as a pointer to its first element. */
const decayed = (type: string): string | null =>
  type.endsWith(']') ? addressType(elementType(type)) : type;

/**
 * What a node evaluates to and what C converts each operand to first: the
 * integer promotions of 6.3.1.1 for the unary arithmetic operators and the
 * shifts, the usual arithmetic conversions of 6.3.1.8 for the binary
 * arithmetic, relational, equality and bitwise operators and for the two
 * arms of `?:`, and the conversion as if by assignment of 6.5.16.1 for `=`
 * and for an initialiser.
 *
 * A compound assignment converts its right operand to the common type with
 * the target; converting the target and converting the result back are left
 * unsaid, since neither has a node of its own to stand over.
 */
function typingOf(
  rule: TypeRule,
  children: ExpressionNodeModel[],
  types: TypeLookup
): Typing {
  const none: (string | null)[] = children.map(() => null);
  const result = (
    type: string | null,
    operands: (string | null)[] = none
  ): Typing => ({ type, operands });
  const of = (index: number): string | null => children[index]?.type ?? null;

  switch (rule.kind) {
    case 'name':
      return result(types.variable(rule.name));
    case 'written':
      return result(types.written(rule.spelling));
    case 'fixed':
      return result(rule.type);
    case 'declaration': {
      const type = rule.spelling === null ? null : types.written(rule.spelling);
      return result(type, [null, rule.list ? null : type]);
    }
    case 'ternary': {
      const whenTrue = of(1);
      const whenFalse = of(2);
      const common =
        whenTrue === null || whenFalse === null
          ? null
          : commonType(whenTrue, whenFalse);
      if (common !== null) {
        return result(common, [null, common, common]);
      }
      return result(
        whenTrue !== null && whenTrue === whenFalse ? whenTrue : null
      );
    }
    case 'unary':
      return unaryTyping(rule.operator, of(0), result);
    case 'binary':
      return binaryTyping(rule.operator, children.length, of(0), of(1), result);
    default:
      return result(null);
  }
}

type Result = (type: string | null, operands?: (string | null)[]) => Typing;

function unaryTyping(
  operator: string,
  operand: string | null,
  result: Result
): Typing {
  switch (operator) {
    case '+':
    case '-':
    case '~': {
      const valid =
        operator === '~' ? isIntegerType(operand) : isArithmeticType(operand);
      if (!valid || operand === null) {
        return result(null);
      }
      const promoted = promotedType(operand);
      return result(promoted, [promoted]);
    }
    case '!':
      return result('int');
    case '*':
      return result(elementType(operand));
    case '&':
      return result(addressType(operand));
    case '++':
    case '--':
      return result(operand);
    case 'sizeof':
      return result('unsigned long');
    default:
      return result(null);
  }
}

function binaryTyping(
  operator: string,
  count: number,
  left: string | null,
  right: string | null,
  result: Result
): Typing {
  if (count === 1) {
    // A postfix update, which the mapper writes without a right side.
    return result(POSTFIX_UPDATE.test(operator) ? left : null);
  }
  const common =
    left === null || right === null ? null : commonType(left, right);
  if (operator === '=') {
    return result(left, [null, left]);
  }
  if (ASSIGNMENT.test(operator)) {
    const shift = operator === '<<=' || operator === '>>=';
    return result(left, [
      null,
      shift ? (isIntegerType(right) ? promotedType(right) : null) : common,
    ]);
  }
  switch (operator) {
    case '*':
    case '/':
    case '%':
    case '+':
    case '-':
    case '&':
    case '|':
    case '^':
      if (common !== null) {
        return result(common, [common, common]);
      }
      if (operator === '+' || operator === '-') {
        if (isPointerType(left) && isIntegerType(right)) {
          return result(decayed(left));
        }
        if (operator === '+' && isIntegerType(left) && isPointerType(right)) {
          return result(decayed(right));
        }
        if (operator === '-' && isPointerType(left) && isPointerType(right)) {
          return result('long');
        }
      }
      return result(null);
    case '<':
    case '>':
    case '<=':
    case '>=':
    case '==':
    case '!=':
      return result('int', common === null ? undefined : [common, common]);
    case '<<':
    case '>>':
      if (!isIntegerType(left) || !isIntegerType(right)) {
        return result(null);
      }
      return result(promotedType(left), [
        promotedType(left),
        promotedType(right),
      ]);
    case '&&':
    case '||':
      return result('int');
    case '[]':
      return result(elementType(left));
    case ',':
      return result(right);
    default:
      return result(null);
  }
}

/**
 * The types of the names the statement about to run can see: the frame being
 * executed and the globals, innermost declaration winning, with the members
 * of each record under their paths. A type the engine had to simplify is
 * read as the reader wrote it (`long long`), and typedefs are resolved.
 */
function typesIn(state: ExecState): TypeLookup {
  const written = (spelling: string): string => {
    const text = spelling.trim();
    const declarator = text.search(/[*[(]/);
    let base = declarator === -1 ? text : text.slice(0, declarator).trim();
    const rest = declarator === -1 ? '' : text.slice(declarator);
    // Typedefs are registered in the global scope; only the base names one.
    for (let depth = 0; depth < 8; depth += 1) {
      let next: unknown;
      try {
        next = state.getTypedef(base);
      } catch {
        break;
      }
      if (typeof next !== 'string' || next === base) {
        break;
      }
      base = next;
    }
    return canonicalType(rest === '' ? base : `${base} ${rest}`);
  };
  const variables = new Map<string, string>();
  const note = (variable: Variable, name: string): void => {
    const type = written(variableType(variable));
    variables.set(name, type);
    const value: unknown = variable.getValue();
    if (!Array.isArray(value) || type.endsWith(']')) {
      return;
    }
    for (const member of value as unknown[]) {
      if (isVariable(member) && member.getName().startsWith(`${name}.`)) {
        note(member, member.getName());
      }
    }
  };
  try {
    const stacks = state.getStacks();
    const global = stacks.find((stack) => stack.name === 'GLOBAL');
    const active = stacks
      .slice()
      .reverse()
      .find((stack) => stack.name !== 'GLOBAL');
    for (const stack of [global, active]) {
      for (const variable of stack?.getVariables() ?? []) {
        if (typeof variable.parentName === 'undefined') {
          note(variable, variable.getName());
        }
      }
    }
  } catch {
    // A state with no frames yet names nothing.
  }
  return {
    variable: (name) => variables.get(name) ?? null,
    written,
  };
}

/** Whether a member of an aggregate's value is a `Variable` of its own. */
const isVariable = (value: unknown): value is Variable =>
  value !== null &&
  typeof value === 'object' &&
  typeof (value as Variable).getName === 'function' &&
  typeof (value as Variable).getValue === 'function';

/** A variable's type as its declaration spells it. */
function variableType(variable: Variable): string {
  const display = displayTypeOf(variable);
  const declared = declarationInfoOf(variable)?.declaredType;
  if (typeof declared === 'undefined' || display.indexOf('(') !== -1) {
    return display;
  }
  const declarator = display.search(/[*[]/);
  return declarator === -1
    ? declared
    : `${declared} ${display.slice(declarator)}`;
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
    // `(long long)` reaches the tree as the engine's one word for it.
    return `(${cSpelling(expression.type)})`;
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
    // `sizeof(long long)` names its type with the engine's one word.
    return cSpelling(expression.name);
  }
  const spelling = literalSpelling(expression);
  if (spelling !== null) {
    return spelling;
  }
  if (expression instanceof UniCharacterLiteral) {
    return `'${expression.value}'`;
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
