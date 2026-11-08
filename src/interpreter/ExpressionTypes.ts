/**
 * The arithmetic of C's types that the expression tree needs to say where a
 * conversion happens: canonical spellings, the integer promotions and the
 * usual arithmetic conversions of C11 6.3.1, and the types of constants of
 * 6.4.4.
 *
 * Plain strings in, plain strings out, so it has no opinion on where a type
 * came from - a declaration, a variable in a frame, a cast - and the trace can
 * ask it about any of them.
 *
 * Widths are the engine's: unicoen.ts gives `int`, `long` and pointers four
 * bytes, so this is ILP32, as the library's typedefs are. They decide one rule
 * here - whether a `long` can hold every `unsigned int`, which it cannot, so
 * the two meet in `unsigned long` - and the value a conversion produces.
 */

interface IntegerType {
  /** Conversion rank, 6.3.1.1: only the order matters. */
  rank: number;
  signed: boolean;
  /** Width in bits, `_Bool`'s one value bit included. */
  bits: number;
}

const INTEGER_TYPES: Record<string, IntegerType> = {
  _Bool: { rank: 0, signed: false, bits: 1 },
  char: { rank: 1, signed: true, bits: 8 },
  'signed char': { rank: 1, signed: true, bits: 8 },
  'unsigned char': { rank: 1, signed: false, bits: 8 },
  short: { rank: 2, signed: true, bits: 16 },
  'unsigned short': { rank: 2, signed: false, bits: 16 },
  int: { rank: 3, signed: true, bits: 32 },
  'unsigned int': { rank: 3, signed: false, bits: 32 },
  long: { rank: 4, signed: true, bits: 32 },
  'unsigned long': { rank: 4, signed: false, bits: 32 },
  'long long': { rank: 5, signed: true, bits: 64 },
  'unsigned long long': { rank: 5, signed: false, bits: 64 },
};

/** Ordered narrowest first, which is the order 6.3.1.8 checks them in reverse. */
const FLOATING_TYPES = ['float', 'double', 'long double'];

const QUALIFIERS =
  /\b(?:const|volatile|restrict|_Atomic|static|extern|register|auto|inline|_Thread_local)\b/g;

const SPECIFIER_WORDS = new Set([
  'signed',
  'unsigned',
  'char',
  'short',
  'int',
  'long',
  'float',
  'double',
  '_Bool',
  'bool',
]);

/**
 * The base specifiers in their canonical order, or the spelling unchanged
 * where it is not made of arithmetic specifiers alone (`struct Node`, a
 * typedef name the caller could not resolve).
 */
const canonicalBase = (spelling: string): string => {
  // The engine glues a sign to the word after it: `unsignedchar`.
  const words = spelling
    .replace(/\b(unsigned|signed)(?=[a-z_])/g, '$1 ')
    .split(/\s+/)
    .filter((word) => word !== '');
  if (words.length === 0 || words.some((word) => !SPECIFIER_WORDS.has(word))) {
    return words.join(' ');
  }
  const has = (word: string) => words.indexOf(word) !== -1;
  const longs = words.filter((word) => word === 'long').length;
  const unsigned = has('unsigned');
  if (has('_Bool') || has('bool')) {
    return '_Bool';
  }
  if (has('double')) {
    return longs !== 0 ? 'long double' : 'double';
  }
  if (has('float')) {
    return 'float';
  }
  if (has('char')) {
    return unsigned ? 'unsigned char' : has('signed') ? 'signed char' : 'char';
  }
  const sign = unsigned ? 'unsigned ' : '';
  if (has('short')) {
    return `${sign}short`;
  }
  if (longs >= 2) {
    return `${sign}long long`;
  }
  if (longs === 1) {
    return `${sign}long`;
  }
  return `${sign}int`;
};

/**
 * One spelling for one type: `unsigned` and `unsignedint` are both
 * `unsigned int`, `int*` is `int *`, and qualifiers are dropped, because a
 * conversion is between unqualified types (6.3.2.1) and that is the only
 * question the tree asks of them.
 */
export function canonicalType(spelling: string): string {
  const text = spelling.replace(QUALIFIERS, ' ').replace(/\s+/g, ' ').trim();
  if (text.indexOf('(') !== -1) {
    // A function pointer spells its declarator inside the type.
    return text;
  }
  const declarator = text.search(/[*[]/);
  const base = declarator === -1 ? text : text.slice(0, declarator);
  const rest = declarator === -1 ? '' : text.slice(declarator);
  const stars = rest.replace(/[^*]/g, '');
  const dimensions = rest.replace(/[\s*]/g, '');
  const canonical = canonicalBase(base.trim());
  return `${canonical}${stars === '' ? '' : ` ${stars}`}${dimensions}`;
}

/**
 * The width and signedness of a canonically spelled integer type, or null for
 * any other type. The engine computes with these (`Arithmetic.ts`), so the
 * value a conversion node shows and the value computed are the same.
 */
export function integerTypeInfo(
  type: string
): { bits: number; signed: boolean; rank: number } | null {
  const integer = INTEGER_TYPES[type];
  return typeof integer === 'undefined' ? null : { ...integer };
}

export const isIntegerType = (type: string | null): type is string =>
  type !== null && Object.prototype.hasOwnProperty.call(INTEGER_TYPES, type);

export const isFloatingType = (type: string | null): type is string =>
  type !== null && FLOATING_TYPES.indexOf(type) !== -1;

export const isArithmeticType = (type: string | null): type is string =>
  isIntegerType(type) || isFloatingType(type);

export const isPointerType = (type: string | null): type is string =>
  type !== null && (type.endsWith('*') || type.endsWith(']'));

/**
 * The integer promotions, 6.3.1.1p2: every type ranked below `int` becomes
 * `int`, which holds all of their values at these widths. Anything else is
 * left as it is.
 */
export function promotedType(type: string): string {
  const integer = INTEGER_TYPES[type];
  return typeof integer !== 'undefined' && integer.rank < INTEGER_TYPES.int.rank
    ? 'int'
    : type;
}

/**
 * The common real type of the usual arithmetic conversions, 6.3.1.8, or null
 * when either operand is not of arithmetic type.
 */
export function commonType(left: string, right: string): string | null {
  if (!isArithmeticType(left) || !isArithmeticType(right)) {
    return null;
  }
  for (const floating of FLOATING_TYPES.slice().reverse()) {
    if (left === floating || right === floating) {
      return floating;
    }
  }
  const a = promotedType(left);
  const b = promotedType(right);
  if (a === b) {
    return a;
  }
  const first = INTEGER_TYPES[a];
  const second = INTEGER_TYPES[b];
  if (first.signed === second.signed) {
    return first.rank >= second.rank ? a : b;
  }
  const [unsigned, signed] = first.signed ? [b, a] : [a, b];
  const u = INTEGER_TYPES[unsigned];
  const s = INTEGER_TYPES[signed];
  if (u.rank >= s.rank) {
    return unsigned;
  }
  if (s.bits > u.bits) {
    return signed;
  }
  return `unsigned ${signed}`;
}

/** What `*p` or `a[i]` is, for a pointer or array type. */
export function elementType(type: string | null): string | null {
  if (type === null) {
    return null;
  }
  const array = /^(.*?)\s*\[[^\]]*\](.*)$/.exec(type);
  if (array !== null) {
    return `${array[1]}${array[2]}`;
  }
  const pointer = /^(.*?)\s*\*$/.exec(type);
  return pointer === null ? null : pointer[1];
}

/** What `&x` is. An array's address is left unspelled. */
export function addressType(type: string | null): string | null {
  if (type === null || type.endsWith(']') || type.indexOf('(') !== -1) {
    return null;
  }
  return type.endsWith('*') ? `${type}*` : `${type} *`;
}

// Built from calls rather than written as `1n`: the tests compile for ES2018,
// which has BigInt at run time but no literal syntax for it.
const ZERO = BigInt(0);
const ONE = BigInt(1);

const fits = (value: bigint, type: string): boolean => {
  const integer = INTEGER_TYPES[type];
  const bits = BigInt(integer.bits);
  return integer.signed
    ? -(ONE << (bits - ONE)) <= value && value < ONE << (bits - ONE)
    : ZERO <= value && value < ONE << bits;
};

/**
 * The type of a constant as written, 6.4.4.1 and 6.4.4.2: the suffix, the
 * base and the value together choose the first type in the standard's list
 * that can hold it.
 */
export function literalType(
  spelling: string,
  floating: boolean,
  value: number
): string | null {
  const text = spelling.trim();
  if (floating || (/[.eEpP]/.test(text) && !/^0[xX]/.test(text))) {
    if (/[fF]$/.test(text)) {
      return 'float';
    }
    return /[lL]$/.test(text) ? 'long double' : 'double';
  }
  const suffix = (/[uUlL]+$/.exec(text) ?? [''])[0].toLowerCase();
  const unsigned = suffix.indexOf('u') !== -1;
  const longs = suffix.replace(/u/g, '').length;
  const decimal = !/^0[0-7xXbB]/.test(text);
  const candidates = (
    longs === 0
      ? ['int', 'long', 'long long']
      : longs === 1
        ? ['long', 'long long']
        : ['long long']
  ).flatMap((type) =>
    unsigned
      ? [`unsigned ${type}`]
      : decimal
        ? [type]
        : [type, `unsigned ${type}`]
  );
  if (!Number.isFinite(value)) {
    return candidates[0];
  }
  const whole = BigInt(Math.trunc(value));
  return candidates.find((type) => fits(whole, type)) ?? null;
}

/** `int → double`: the text a conversion node carries. */
export const conversionText = (from: string, to: string): string =>
  `${from} → ${to}`;

const DECIMAL = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * A floating value as the tree shows it: with a decimal point even when it is
 * whole, so `5` converted to `double` reads `5.0` and the conversion is seen
 * to have done something.
 */
const floatingText = (value: number): string =>
  Number.isInteger(value) && Math.abs(value) < 1e21
    ? value.toFixed(1)
    : String(value);

/**
 * What a value becomes when converted, 6.3.1.2 to 6.3.1.5, or null when that
 * cannot be said: the value is not a number as the tree writes one, or the
 * conversion is undefined (a floating value outside the integer's range).
 *
 * An unsigned target wraps modulo 2^N; a signed one is implementation-defined
 * there, and wraps on every machine the course uses.
 */
export function convertedValue(
  value: string | null,
  from: string,
  to: string
): string | null {
  if (value === null) {
    return null;
  }
  // A character is shown with its code beside it: `'a' (97)`.
  const code = /\((-?\d+)\)$/.exec(value);
  const text = code === null ? value.trim() : code[1];
  if (!DECIMAL.test(text)) {
    return null;
  }
  const number = Number(text);
  if (!Number.isFinite(number)) {
    return null;
  }
  if (isFloatingType(to)) {
    return floatingText(to === 'float' ? Math.fround(number) : number);
  }
  const integer = INTEGER_TYPES[to];
  if (typeof integer === 'undefined') {
    return null;
  }
  if (to === '_Bool') {
    return number === 0 ? '0' : '1';
  }
  const whole = BigInt(Math.trunc(number));
  if (isFloatingType(from) && !fits(whole, to)) {
    return null;
  }
  const bits = integer.bits;
  return String(
    integer.signed ? BigInt.asIntN(bits, whole) : BigInt.asUintN(bits, whole)
  );
}
