import {
  commonType,
  integerTypeInfo,
  isArithmeticType,
  isFloatingType,
  isIntegerType,
  promotedType,
} from './ExpressionTypes';

/**
 * C's binary arithmetic on values whose types are known: the integer
 * promotions and the usual arithmetic conversions of C11 6.3.1, then the
 * operation at the width of the type it is carried out in.
 *
 * unicoen.ts computes in plain JavaScript numbers, which have no unsigned
 * types and no widths: `-1 < 0u` was true, `0u - 1` was -1, and `INT_MAX + 1`
 * was 2147483648 until something stored it. The rules are the ones
 * `ExpressionTypes.ts` draws conversion nodes with, so the tree and the value
 * it shows agree.
 *
 * Pure numbers in and out; `CPP14Engine.ts` turns them back into the engine's
 * values. Widths are the engine's (ILP32).
 */

/** The operators this module computes; anything else is left to the engine. */
export const TYPED_OPERATORS = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '&',
  '|',
  '^',
  '<<',
  '>>',
  '<',
  '>',
  '<=',
  '>=',
  '==',
  '!=',
]);

const RELATIONAL = new Set(['<', '>', '<=', '>=', '==', '!=']);

export interface ArithmeticResult {
  /** The value, or the truth of a comparison. */
  value: number | boolean;
  /** The type the result has: the common type, or `int` for a comparison. */
  type: string;
  /** The exact result did not fit the signed type it was computed in. */
  overflow: boolean;
  /** A shift by a negative count, or by the type's width or more. */
  badShift: boolean;
  /** An integer division or remainder by zero. */
  divisionByZero: boolean;
}

const wrap = (value: bigint, type: string): bigint => {
  const info = integerTypeInfo(type)!;
  return info.signed
    ? BigInt.asIntN(info.bits, value)
    : BigInt.asUintN(info.bits, value);
};

/**
 * A value as an object of a type holds it (6.3.1.2 to 6.3.1.4): an integer
 * type wraps modulo 2^N - which C defines for an unsigned target and every
 * machine a course uses does for a signed one - and `_Bool` is 0 or 1.
 * Floating types and anything unknown are left alone.
 */
export function valueAs(raw: number, type: string): number {
  if (isFloatingType(type) || !isIntegerType(type)) {
    return raw;
  }
  if (type === '_Bool') {
    return raw !== 0 && !Number.isNaN(raw) ? 1 : 0;
  }
  if (!Number.isFinite(raw)) {
    // Undefined in C; there is no integer to wrap.
    return raw;
  }
  return Number(wrap(BigInt(Math.trunc(raw)), type));
}

/** A value of one type converted to another. */
const converted = (raw: number, from: string, to: string): number =>
  valueAs(valueAs(raw, from), to);

const compare = (op: string, a: number, b: number): boolean => {
  switch (op) {
    case '<':
      return a < b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    case '>=':
      return a >= b;
    case '==':
      return a === b;
    default:
      return a !== b;
  }
};

const result = (
  value: number | boolean,
  type: string,
  flags: Partial<ArithmeticResult> = {}
): ArithmeticResult => ({
  value,
  type,
  overflow: false,
  badShift: false,
  divisionByZero: false,
  ...flags,
});

function shifted(
  op: string,
  left: number,
  leftType: string,
  right: number,
  rightType: string
): ArithmeticResult | null {
  if (!isIntegerType(leftType) || !isIntegerType(rightType)) {
    return null;
  }
  // The shifts promote each operand on its own; the result has the left's.
  const type = promotedType(leftType);
  const bits = integerTypeInfo(type)!.bits;
  const value = converted(left, leftType, type);
  const count = converted(right, rightType, promotedType(rightType));
  const badShift = count < 0 || count >= bits;
  // What the processor does with a count it was not meant to get: x86 keeps
  // the low bits of it, which is also what the engine did before.
  const by = BigInt(((count % bits) + bits) % bits);
  const exact = op === '<<' ? BigInt(value) << by : BigInt(value) >> by;
  const wrapped = wrap(exact, type);
  return result(Number(wrapped), type, {
    badShift,
    overflow:
      op === '<<' &&
      !badShift &&
      integerTypeInfo(type)!.signed &&
      wrapped !== exact,
  });
}

/**
 * `left op right` as C computes it, or null when either type is not
 * arithmetic or the operator is not one of `TYPED_OPERATORS` - the engine's
 * own rule (pointer arithmetic, say) applies then.
 */
export function evaluate(
  op: string,
  left: number,
  leftType: string,
  right: number,
  rightType: string
): ArithmeticResult | null {
  if (
    !TYPED_OPERATORS.has(op) ||
    !isArithmeticType(leftType) ||
    !isArithmeticType(rightType)
  ) {
    return null;
  }
  if (op === '<<' || op === '>>') {
    return shifted(op, left, leftType, right, rightType);
  }
  const common = commonType(leftType, rightType);
  if (common === null) {
    return null;
  }
  const a = converted(left, leftType, common);
  const b = converted(right, rightType, common);
  if (RELATIONAL.has(op)) {
    return result(compare(op, a, b), 'int');
  }
  if (isFloatingType(common)) {
    switch (op) {
      case '+':
        return result(a + b, common);
      case '-':
        return result(a - b, common);
      case '*':
        return result(a * b, common);
      case '/':
        return result(a / b, common);
      default:
        // `%` and the bitwise operators take integers only.
        return null;
    }
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return null;
  }
  if ((op === '/' || op === '%') && b === 0) {
    return result(0, common, { divisionByZero: true });
  }
  const x = BigInt(a);
  const y = BigInt(b);
  let exact: bigint;
  switch (op) {
    case '+':
      exact = x + y;
      break;
    case '-':
      exact = x - y;
      break;
    case '*':
      exact = x * y;
      break;
    case '/':
      // BigInt division truncates toward zero, as C's does.
      exact = x / y;
      break;
    case '%':
      exact = x % y;
      // `INT_MIN % -1` is undefined for the same reason `INT_MIN / -1` is.
      if (wrap(x / y, common) !== x / y) {
        return result(Number(wrap(exact, common)), common, { overflow: true });
      }
      break;
    case '&':
      exact = x & y;
      break;
    case '|':
      exact = x | y;
      break;
    default:
      exact = x ^ y;
      break;
  }
  const wrapped = wrap(exact, common);
  return result(Number(wrapped), common, {
    overflow: integerTypeInfo(common)!.signed && wrapped !== exact,
  });
}
