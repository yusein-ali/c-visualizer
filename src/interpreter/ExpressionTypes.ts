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
 * bytes and `long long` eight, so this is ILP32, as the library's typedefs
 * are. They decide one rule here - whether a `long` can hold every `unsigned
 * int`, which it cannot, so the two meet in `unsigned long` - and the value a
 * conversion produces.
 */

/**
 * `long long` and `unsigned long long` as the engine spells them.
 *
 * unicoen's mapper reads one type word, so `DeclarationSpecifiers` writes the
 * sequence as one identifier no longer than it - every source position stays
 * where it was - and `CPP14Engine` teaches the engine's `sizeof` that it is
 * eight bytes. Reserved spellings (an underscore and a capital), so no
 * program's own name can be one. Nothing shown to the reader carries them:
 * `cSpelling` puts C's words back.
 */
export const ENGINE_LONG_LONG = '_LongLong';
export const ENGINE_UNSIGNED_LONG_LONG = '_ULongLong';

/** Either engine spelling of `long long`, as a word. */
export const ENGINE_LONG_LONG_WORD = /\b_U?LongLong\b/;

/** A type as C spells it, with the engine's spellings of `long long` undone. */
export const cSpelling = (type: string): string =>
  type
    .replace(/\b_ULongLong\b/g, 'unsigned long long')
    .replace(/\b_LongLong\b/g, 'long long');

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
  const text = cSpelling(spelling)
    .replace(QUALIFIERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

const TWO_63 = 2 ** 63;
const TWO_64 = 2 ** 64;

/**
 * An integer the engine holds as a JavaScript number, as a `bigint` for the
 * type it has.
 *
 * A number is exact only up to 2^53, and the 64-bit types reach past that.
 * Their two largest values are the case worth a rule: 2^63 - 1 and 2^64 - 1
 * round up to 2^63 and 2^64, which no object of the type can hold, so taken
 * at face value `LLONG_MAX` wrapped to `LLONG_MIN` the moment anything
 * converted it. A number of exactly that size is read as the maximum it was
 * rounded from. Every other value is the number's own.
 */
export function exactInteger(value: number, type: string): bigint {
  const integer = INTEGER_TYPES[type];
  if (typeof integer !== 'undefined' && integer.bits === 64) {
    if (value === TWO_64) {
      return (ONE << BigInt(64)) - ONE;
    }
    if (integer.signed && value === TWO_63) {
      return (ONE << BigInt(63)) - ONE;
    }
  }
  return BigInt(Math.trunc(value));
}

/**
 * Whether a value of an integer type is lost by holding it in a number: past
 * 2^53, except the two `exactInteger` reads back.
 */
export const isInexact = (value: bigint, type: string): boolean =>
  exactInteger(Number(value), type) !== value;

/**
 * An integer constant's value from its spelling (`077`, `0x1F`, `42ULL`), or
 * null for any other spelling. Exact at any size, which the number the
 * parser read it as is not past 2^53.
 */
export function exactLiteral(spelling: string): bigint | null {
  const digits = spelling.trim().replace(/[uUlL]+$/, '');
  if (/^0[xX][0-9a-fA-F]+$/.test(digits) || /^0[bB][01]+$/.test(digits)) {
    return BigInt(digits);
  }
  if (/^0[0-7]+$/.test(digits)) {
    return BigInt(`0o${digits.slice(1)}`);
  }
  return /^(?:0|[1-9][0-9]*)$/.test(digits) ? BigInt(digits) : null;
}

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
  // The spelling, not the number: `9223372036854775807LL` is a `long long`,
  // and the number it was read as, 2^63, is not.
  const whole = exactLiteral(text) ?? BigInt(Math.trunc(value));
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
  const whole = exactInteger(number, from);
  if (isFloatingType(from) && !fits(whole, to)) {
    return null;
  }
  const bits = integer.bits;
  return String(
    integer.signed ? BigInt.asIntN(bits, whole) : BigInt.asUintN(bits, whole)
  );
}
