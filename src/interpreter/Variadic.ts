import { Int } from 'unicoen.ts/dist/interpreter/CPP14/Int';
import { UniBinOp } from 'unicoen.ts/dist/node/UniBinOp';
import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniTernaryOp } from 'unicoen.ts/dist/node/UniTernaryOp';
import { UniUnaryOp } from 'unicoen.ts/dist/node/UniUnaryOp';
import {
  canonicalType,
  commonType,
  isArithmeticType,
  isFloatingType,
  isIntegerType,
  isPointerType,
  promotedType,
} from './ExpressionTypes';
import { LIBRARY_TYPEDEFS } from './library/types';
import { mask } from './scan';

/**
 * What the engine needs to call a function declared with `...`.
 *
 * unicoen's grammar accepts the ellipsis and its mapper then drops it, so a
 * `UniFunctionDec` does not say whether the function is variadic and the
 * stock call binds arguments to parameters one for one - a call with more
 * arguments than parameters died in the middle of binding them. The engine
 * reads which functions are variadic from the source (`variadicFunctionsIn`),
 * binds the named parameters as usual, and files the rest in the callee's
 * frame as rows of their own, after the named parameters, each with the type
 * the default argument promotions give it (C11 6.5.2.2p6-7). `va_start`,
 * `va_arg` and the `v*printf` family read them from there.
 *
 * A promoted type is known from the argument expression where the engine can
 * tell it (`staticTypeOf` plus the operators below), and guessed from the
 * value only where it cannot: the engine keeps an `int` as its `Int`, a
 * string literal as its bytes, and a pointer and a `double` both as a plain
 * number.
 */

/** The row an unnamed argument is drawn as: `...[0]`, `...[1]`, ... */
export const variadicName = (index: number): string => `...[${index}]`;

/**
 * The functions the program defines with a parameter list ending in `...`.
 * A prototype alone does not count: there is nothing to call without a body.
 */
export function variadicFunctionsIn(source: string): Set<string> {
  const names = new Set<string>();
  const pattern = /\b([A-Za-z_]\w*)\s*\(([^()]*)\.\.\.\s*\)\s*\{/g;
  const text = mask(source);
  let found = pattern.exec(text);
  while (found !== null) {
    names.add(found[1]);
    found = pattern.exec(text);
  }
  return names;
}

/**
 * A type as `va_arg` compares two of them: typedef names resolved, an enum
 * as the `int` it is, an array as the pointer it decays to, one spelling per
 * type (`ExpressionTypes.canonicalType`).
 */
export function canonicalArgumentType(
  type: string,
  resolve: (type: string) => string = (spelled) => spelled
): string {
  let spelled = resolve(type.trim());
  const library = LIBRARY_TYPEDEFS[spelled];
  if (typeof library !== 'undefined') {
    spelled = library.underlying;
  }
  if (/^_e\d+$/.test(spelled) || /^enum\b/.test(spelled)) {
    return 'int';
  }
  const array = /^([^[]*)\[[^\]]*\]((?:\[[^\]]*\])*)$/.exec(spelled);
  if (array !== null) {
    spelled = `${array[1].trim()}${array[2] === '' ? '*' : `(*)${array[2]}`}`;
  }
  return canonicalType(spelled);
}

/** The default argument promotions of 6.5.2.2p6, on a canonical type. */
export function promotedArgumentType(canonical: string): string {
  if (canonical === 'float') {
    return 'double';
  }
  return isIntegerType(canonical) ? promotedType(canonical) : canonical;
}

/** What `va_arg` checks a requested type against: the three kinds of value. */
export type ArgumentClass = 'integer' | 'floating' | 'pointer' | 'other';

export function argumentClass(canonical: string): ArgumentClass {
  if (isIntegerType(canonical)) {
    return 'integer';
  }
  if (isFloatingType(canonical)) {
    return 'floating';
  }
  return isPointerType(canonical) || /\(\*\)/.test(String(canonical))
    ? 'pointer'
    : 'other';
}

/**
 * Whether C defines reading an argument passed as `given` with `va_arg` of
 * `requested` (7.16.1.1p2): the same type, a signed and unsigned pair, or
 * `void *` against a pointer to a character type.
 */
export function compatibleArgument(requested: string, given: string): boolean {
  if (requested === given) {
    return true;
  }
  const unsigned = (type: string): string =>
    type.startsWith('unsigned ') ? type : `unsigned ${type}`;
  if (
    isIntegerType(requested) &&
    isIntegerType(given) &&
    unsigned(requested) === unsigned(given)
  ) {
    return true;
  }
  const voidOrChar = /^(?:void|char|signed char|unsigned char) \*$/;
  return voidOrChar.test(requested) && voidOrChar.test(given);
}

/** How a type is spelled in the engine: no space before the stars. */
const engineSpelling = (type: string): string =>
  type.replace(/\s+\*/g, '*').trim();

/** What the engine can tell of an expression without evaluating it. */
export interface ArgumentTyping {
  /** The engine's own static type, or null where it has none. */
  staticTypeOf(expr: unknown): string | null;
  /** The declared kind of a name: a type, `FUNCTION`, or null if unknown. */
  declaredTypeOf(name: string): string | null;
  /** The return type of the function a call names, if the program defines it. */
  returnTypeOf(call: UniMethodCall): string | null;
  /** A typedef name as what it stands for. */
  resolve(type: string): string;
}

const COMPARISONS = ['==', '!=', '<', '>', '<=', '>=', '&&', '||'];
const ARITHMETIC = ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>'];

/** The type of an argument expression, or null where it cannot be told. */
export function argumentTypeOf(
  expr: unknown,
  typing: ArgumentTyping
): string | null {
  const canonical = (type: string | null): string | null =>
    type === null ? null : canonicalArgumentType(type, typing.resolve);
  if (expr instanceof UniIdent) {
    const declared = typing.declaredTypeOf(expr.name);
    if (declared === 'FUNCTION') {
      // A function designator becomes a pointer to the function.
      return 'void*';
    }
    return declared === null || declared === 'CLASS'
      ? null
      : typing.staticTypeOf(expr);
  }
  if (expr instanceof UniBinOp) {
    const op = expr.operator;
    if (COMPARISONS.indexOf(op) !== -1) {
      return 'int';
    }
    if (ARITHMETIC.indexOf(op) !== -1) {
      const left = argumentTypeOf(expr.left, typing);
      const right = argumentTypeOf(expr.right, typing);
      const l = canonical(left);
      const r = canonical(right);
      if (l === null || r === null) {
        return null;
      }
      if (
        (op === '+' || op === '-') &&
        (isPointerType(l) || isPointerType(r))
      ) {
        if (isPointerType(l) && isPointerType(r)) {
          return 'int';
        }
        return isPointerType(l) ? l : r;
      }
      if (op === '<<' || op === '>>') {
        return isIntegerType(l) ? promotedType(l) : null;
      }
      return commonType(l, r);
    }
    if (/^[^=!<>]?=$|^(<<|>>)=$/.test(op)) {
      return argumentTypeOf(expr.left, typing);
    }
    return typing.staticTypeOf(expr);
  }
  if (expr instanceof UniUnaryOp) {
    switch (expr.operator) {
      case '!':
        return 'int';
      case '-':
      case '+':
      case '~': {
        const operand = canonical(argumentTypeOf(expr.expr, typing));
        return operand === null || !isArithmeticType(operand)
          ? null
          : isIntegerType(operand)
            ? promotedType(operand)
            : operand;
      }
      case '++_':
      case '_++':
      case '--_':
      case '_--':
      case '()':
        return argumentTypeOf(expr.expr, typing);
      case 'sizeof':
        return 'unsigned long';
      default:
        return typing.staticTypeOf(expr);
    }
  }
  if (expr instanceof UniTernaryOp) {
    const whenTrue = canonical(argumentTypeOf(expr.trueExpr, typing));
    const whenFalse = canonical(argumentTypeOf(expr.falseExpr, typing));
    if (whenTrue !== null && whenFalse !== null) {
      return commonType(whenTrue, whenFalse) ?? whenTrue;
    }
    return whenTrue ?? whenFalse;
  }
  if (expr instanceof UniMethodCall) {
    return typing.returnTypeOf(expr);
  }
  return typing.staticTypeOf(expr);
}

/**
 * What an argument's value says about its type when its expression does not:
 * the engine's `Int` is an integer, an array of bytes is a string literal, a
 * plain number that is the address of something is a pointer, and any other
 * plain number is a `double`.
 */
export function typeOfValue(
  value: unknown,
  isAddress: (address: number) => boolean
): string {
  if (value instanceof Int || typeof value === 'boolean') {
    return 'int';
  }
  if (Array.isArray(value) || typeof value === 'string') {
    return 'char*';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) && value !== 0 && isAddress(value)
      ? 'void*'
      : 'double';
  }
  return 'int';
}

/**
 * One unnamed argument as the callee's frame files it: its promoted type,
 * spelled the way the engine spells types, and its value converted to it.
 */
export function promotedArgument(
  type: string,
  value: unknown,
  resolve: (type: string) => string
): { type: string; value: unknown } {
  const canonical = canonicalArgumentType(type, resolve);
  const promoted = promotedArgumentType(canonical);
  if (promoted === 'int' && !(value instanceof Int)) {
    const n = Number((value as { valueOf(): unknown })?.valueOf?.() ?? value);
    return { type: 'int', value: new Int(Number.isFinite(n) ? n : 0) };
  }
  if (Array.isArray(value)) {
    // `Scope.setTop` writes a literal's bytes out and appends the
    // terminator to the array it is given: hand it a copy.
    return { type: 'char*', value: value.slice() };
  }
  if (promoted === canonical) {
    // Keep the reader's spelling where nothing changed it: `size_t`, not
    // `unsigned long`.
    return {
      type: engineSpelling(
        isPointerType(canonical) && type.indexOf('[') !== -1 ? canonical : type
      ),
      value,
    };
  }
  return { type: engineSpelling(promoted), value };
}
