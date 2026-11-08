import { UniBinOp } from 'unicoen.ts/dist/node/UniBinOp';
import { UniBlock } from 'unicoen.ts/dist/node/UniBlock';
import { UniCast } from 'unicoen.ts/dist/node/UniCast';
import { UniExpr } from 'unicoen.ts/dist/node/UniExpr';
import { UniFor } from 'unicoen.ts/dist/node/UniFor';
import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniIntLiteral } from 'unicoen.ts/dist/node/UniIntLiteral';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniParam } from 'unicoen.ts/dist/node/UniParam';
import { UniSwitchUnit } from 'unicoen.ts/dist/node/UniSwitchUnit';
import { UniUnaryOp } from 'unicoen.ts/dist/node/UniUnaryOp';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniVariableDef } from 'unicoen.ts/dist/node/UniVariableDef';
import { CodeLocation } from 'unicoen.ts/dist/node_helper/CodeLocation';
import { CodeRange } from 'unicoen.ts/dist/node_helper/CodeRange';
import { ENGINE_LONG_LONG, ENGINE_UNSIGNED_LONG_LONG } from './ExpressionTypes';
import { LIBRARY_TYPE_NAMES } from './library/types';
import { mask, matchBrace, splitTopLevel } from './scan';

/**
 * Typedef names where C's grammar needs to know them.
 *
 * C cannot be parsed without knowing which identifiers are typedef names:
 * `Node *head = NULL;` declares a pointer when `Node` is a type and multiplies
 * when it is an object, and `(T)-2` is a cast or a subtraction the same way.
 * unicoen's C++ grammar decides without knowing, and takes the expression -
 * so a linked list's `Node *n = malloc(sizeof(Node));` was a multiplication
 * whose left operand named nothing, and `(ptrdiff_t)-2` subtracted 2 from a
 * type. The jscpp syntax check refused `(myint)x` for the same reason.
 *
 * The names are read from the source, then the trees the two parsers build
 * are corrected where only a typedef name could have made them wrong.
 */

/** The names a program declares with `typedef`, read from its text. */
export function typedefNamesIn(code: string): Set<string> {
  const masked = mask(code);
  const names = new Set<string>();
  const keyword = /\btypedef\b/g;
  let found = keyword.exec(masked);
  while (found !== null) {
    // The declaration runs to the first `;` outside braces.
    let end = found.index + 'typedef'.length;
    let text = '';
    while (end < masked.length && masked[end] !== ';') {
      if (masked[end] === '{') {
        const close = matchBrace(masked, end);
        if (close === -1) {
          break;
        }
        // A body's members are not the declarators: keep a space in its place.
        text += ' ';
        end = close + 1;
        continue;
      }
      text += masked[end];
      end += 1;
    }
    for (const part of splitTopLevel(text, ',')) {
      const pointer = /\(\s*\*+\s*([A-Za-z_]\w*)\s*\)/.exec(part);
      const declarator = part.replace(/\[[^\]]*\]/g, ' ').trim();
      const name =
        pointer !== null
          ? pointer[1]
          : (/([A-Za-z_]\w*)\s*$/.exec(declarator) ?? [])[1];
      if (typeof name === 'string') {
        names.add(name);
      }
    }
    keyword.lastIndex = end;
    found = keyword.exec(masked);
  }
  return names;
}

/**
 * The typedef names a tree should be corrected for: the program's own and the
 * library's, less any name the program also declares as an object or a
 * parameter somewhere. Such a name could be either at any given use, and a
 * guess that turns an expression into a declaration is worse than none.
 */
export function typeNamesFor(code: string, tree: unknown): Set<string> {
  const names = typedefNamesIn(code);
  // The engine's one-word `long long` reads like a typedef name to the
  // grammar: `long long *p` arrives as `_LongLong *p`.
  for (const name of LIBRARY_TYPE_NAMES.concat(
    ENGINE_LONG_LONG,
    ENGINE_UNSIGNED_LONG_LONG
  )) {
    names.add(name);
  }
  for (const name of objectNamesIn(tree)) {
    names.delete(name);
  }
  return names;
}

/** Every object and parameter name a tree declares. */
function objectNamesIn(tree: unknown): Set<string> {
  const names = new Set<string>();
  walk(tree, (node) => {
    if (
      node instanceof UniVariableDec &&
      !(Array.isArray(node.modifiers) && node.modifiers.includes('typedef'))
    ) {
      for (const variable of node.variables ?? []) {
        if (typeof variable?.name === 'string') {
          names.add(variable.name.replace(/^[*&]+/, ''));
        }
      }
    }
    if (node instanceof UniParam) {
      for (const variable of node.variables ?? []) {
        if (typeof variable?.name === 'string') {
          names.add(variable.name.replace(/^[*&]+/, ''));
        }
      }
    }
  });
  return names;
}

/** Visits every node of a unicoen tree, parents first. */
function walk(root: unknown, visit: (node: any) => void): void {
  const seen = new Set<unknown>();
  const go = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(go);
      return;
    }
    visit(node);
    const fields = (node as { fields?: Map<string, unknown> }).fields;
    if (typeof fields === 'undefined') {
      return;
    }
    for (const field of Array.from(fields.keys())) {
      if (field !== 'comments' && field !== 'codeRange') {
        go((node as Record<string, unknown>)[field]);
      }
    }
  };
  go(root);
}

/** The source's lines, for reading what the tree dropped (parentheses). */
class SourceText {
  private readonly lines: string[];

  constructor(code: string) {
    this.lines = code.split('\n');
  }

  /** The first non-blank character before a position, on its line. */
  before(location: { x: number; y: number }): string {
    const line = this.lines[location.y - 1] ?? '';
    return line.slice(0, location.x).trimEnd().slice(-1);
  }

  /** The first non-blank character at or after a position, on its line. */
  after(location: { x: number; y: number }): string {
    const line = this.lines[location.y - 1] ?? '';
    return line.slice(location.x).trimStart().charAt(0);
  }

  /** Where the first `*` at or after a position is, on its line. */
  star(location: { x: number; y: number }): CodeLocation {
    const line = this.lines[location.y - 1] ?? '';
    const at = line.indexOf('*', location.x);
    return new CodeLocation(at === -1 ? location.x : at, location.y);
  }
}

const rangeOf = (node: any): CodeRange | null =>
  node !== null &&
  typeof node === 'object' &&
  node.codeRange &&
  node.codeRange.begin &&
  node.codeRange.end
    ? node.codeRange
    : null;

const spanning = (from: CodeLocation, to: CodeLocation): CodeRange =>
  new CodeRange(new CodeLocation(from.x, from.y), new CodeLocation(to.x, to.y));

interface Declarator {
  name: string;
  typeSuffix: string | null;
}

/** `p`, `*p`, `**p`, `p[3]` written as an expression, as a declarator. */
function declaratorOf(expr: unknown): Declarator | null {
  if (expr instanceof UniIdent) {
    return { name: expr.name, typeSuffix: null };
  }
  if (expr instanceof UniUnaryOp && expr.operator === '*') {
    const inner = declaratorOf(expr.expr);
    return inner === null ? null : { ...inner, name: `*${inner.name}` };
  }
  if (
    expr instanceof UniBinOp &&
    expr.operator === '[]' &&
    expr.right instanceof UniIntLiteral
  ) {
    const inner = declaratorOf(expr.left);
    return inner === null
      ? null
      : {
          ...inner,
          typeSuffix: `${inner.typeSuffix ?? ''}[${expr.right.value}]`,
        };
  }
  return null;
}

/**
 * The declaration an expression statement really is, or null when it is an
 * expression after all. The shapes are the ones the C++ grammar gives
 * `T *a = x, *b;`: a comma list whose first item is `T * a` (or that with an
 * initialiser), and whose other items are declarators.
 */
function declarationOf(
  statement: unknown,
  types: Set<string>,
  source: SourceText
): UniVariableDec | null {
  if (!(statement instanceof UniBinOp)) {
    return null;
  }
  const items: UniExpr[] = [];
  let rest: UniExpr = statement;
  while (rest instanceof UniBinOp && rest.operator === ',') {
    items.unshift(rest.right);
    rest = rest.left;
  }
  items.unshift(rest);

  const split = (item: unknown): { target: unknown; value: UniExpr | null } =>
    item instanceof UniBinOp && item.operator === '='
      ? { target: item.left, value: item.right }
      : { target: item, value: null };

  const first = split(items[0]);
  const head = first.target;
  if (
    !(head instanceof UniBinOp) ||
    head.operator !== '*' ||
    !(head.left instanceof UniIdent) ||
    !types.has(head.left.name)
  ) {
    return null;
  }
  const typeName = head.left;
  const typeRange = rangeOf(typeName);
  // `(T) * p` is a cast, not a declaration: there the name is closed off.
  if (typeRange === null || source.after(typeRange.end) === ')') {
    return null;
  }
  const definitions: UniVariableDef[] = [];
  const firstDeclarator = declaratorOf(head.right);
  if (firstDeclarator === null) {
    return null;
  }
  const define = (
    declarator: Declarator,
    value: UniExpr | null,
    from: CodeLocation,
    to: CodeLocation
  ): void => {
    const definition = new UniVariableDef(
      declarator.name,
      value as UniExpr,
      declarator.typeSuffix as string
    );
    definition.codeRange = spanning(from, to);
    definitions.push(definition);
  };
  const firstEnd = rangeOf(first.value ?? head.right);
  if (firstEnd === null) {
    return null;
  }
  define(
    { ...firstDeclarator, name: `*${firstDeclarator.name}` },
    first.value,
    source.star(typeRange.end),
    firstEnd.end
  );
  for (const item of items.slice(1)) {
    const { target, value } = split(item);
    const declarator = declaratorOf(target);
    const range = rangeOf(item);
    if (declarator === null || range === null) {
      return null;
    }
    define(declarator, value, range.begin, range.end);
  }
  const declaration = new UniVariableDec([], typeName.name, definitions);
  declaration.codeRange = rangeOf(statement)!;
  return declaration;
}

/** The unary operator a binary one stands in for after a cast. */
const CAST_OPERAND = new Set(['+', '-', '*', '&']);

/** Operators whose operands bind looser than a cast does. */
const BINARY = new Set([
  '*',
  '/',
  '%',
  '+',
  '-',
  '<<',
  '>>',
  '<',
  '>',
  '<=',
  '>=',
  '==',
  '!=',
  '&',
  '^',
  '|',
  '&&',
  '||',
]);

/**
 * `(T) op R` read back as the cast it is: `(T)(op L)`, where `L` is the
 * leftmost operand of `R` - everything in `R` binds tighter than `op`, and a
 * cast binds tighter than all of it, so `(T)-2*3` is `((T)-2)*3`.
 */
function castOf(
  expr: unknown,
  types: Set<string>,
  source: SourceText
): UniExpr | null {
  if (
    !(expr instanceof UniBinOp) ||
    !CAST_OPERAND.has(expr.operator) ||
    !(expr.left instanceof UniIdent) ||
    !types.has(expr.left.name) ||
    !(expr.right instanceof UniExpr)
  ) {
    return null;
  }
  const typeRange = rangeOf(expr.left);
  const whole = rangeOf(expr);
  if (
    typeRange === null ||
    whole === null ||
    source.before(typeRange.begin) !== '(' ||
    source.after(typeRange.end) !== ')'
  ) {
    return null;
  }
  const typeName = expr.left.name;
  const cast = (operand: UniExpr): UniExpr => {
    const range = rangeOf(operand);
    const unary = new UniUnaryOp(expr.operator, operand);
    const converted = new UniCast(typeName, unary);
    if (range !== null) {
      const operator = source.before(range.begin);
      unary.codeRange = spanning(
        operator === expr.operator
          ? new CodeLocation(Math.max(0, range.begin.x - 1), range.begin.y)
          : range.begin,
        range.end
      );
      converted.codeRange = spanning(whole.begin, range.end);
    }
    return converted;
  };
  let parent: UniBinOp | null = null;
  let leftmost: UniExpr = expr.right;
  while (leftmost instanceof UniBinOp && BINARY.has(leftmost.operator)) {
    parent = leftmost;
    leftmost = leftmost.left;
  }
  if (parent === null) {
    return cast(leftmost);
  }
  parent.left = cast(leftmost);
  return expr.right;
}

/**
 * `(T)(x)` read back as the cast it is. Not knowing `T` is a type, the
 * grammar reads a call of `T` - parenthesised, which C allows of a function
 * name - with the argument `x`, and the run stopped on a call to a function
 * that does not exist: `(size_t)(-1)` and `(Byte)(n)` both did. A call of a
 * typedef name with one argument, its name alone in parentheses, can only be
 * a cast.
 */
function callCastOf(
  expr: unknown,
  types: Set<string>,
  source: SourceText
): UniExpr | null {
  if (
    !(expr instanceof UniMethodCall) ||
    (expr.receiver !== null && typeof expr.receiver !== 'undefined') ||
    !(expr.methodName instanceof UniIdent) ||
    !types.has(expr.methodName.name) ||
    !Array.isArray(expr.args) ||
    expr.args.length !== 1 ||
    !(expr.args[0] instanceof UniExpr)
  ) {
    return null;
  }
  const typeRange = rangeOf(expr.methodName);
  if (
    typeRange === null ||
    source.before(typeRange.begin) !== '(' ||
    source.after(typeRange.end) !== ')'
  ) {
    return null;
  }
  const converted = new UniCast(expr.methodName.name, expr.args[0]);
  const whole = rangeOf(expr);
  if (whole !== null) {
    converted.codeRange = spanning(whole.begin, whole.end);
  }
  return converted;
}

/**
 * Corrects, in place, the declarations and casts the C++ grammar read as
 * expressions because it did not know a name was a type.
 */
export function resolveTypedefAmbiguities(
  tree: unknown,
  types: Set<string>,
  code: string
): void {
  if (types.size === 0) {
    return;
  }
  const source = new SourceText(code);
  const statements = (list: unknown[]): void => {
    list.forEach((statement, index) => {
      const declaration = declarationOf(statement, types, source);
      if (declaration !== null) {
        list[index] = declaration;
      }
    });
  };
  walk(tree, (node) => {
    if (node instanceof UniBlock && Array.isArray(node.body)) {
      statements(node.body);
    }
    if (node instanceof UniSwitchUnit && Array.isArray(node.statement)) {
      statements(node.statement);
    }
    if (node instanceof UniFor) {
      const declaration = declarationOf(node.init, types, source);
      if (declaration !== null) {
        node.init = declaration;
      }
    }
    const fields = (node as { fields?: Map<string, unknown> }).fields;
    if (typeof fields === 'undefined') {
      return;
    }
    for (const field of Array.from(fields.keys())) {
      if (field === 'comments' || field === 'codeRange') {
        continue;
      }
      const child = node[field];
      if (Array.isArray(child)) {
        child.forEach((item, index) => {
          const cast =
            castOf(item, types, source) ?? callCastOf(item, types, source);
          if (cast !== null) {
            child[index] = cast;
          }
        });
      } else {
        const cast =
          castOf(child, types, source) ?? callCastOf(child, types, source);
        if (cast !== null) {
          node[field] = cast;
        }
      }
    }
  });
}
