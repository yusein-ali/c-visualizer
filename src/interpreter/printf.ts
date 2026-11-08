/**
 * `printf` formatting the way C defines it, with no interpreter behind it.
 *
 * `unicoen.ts` hands formatting to the `agh.sprintf` package and converts the
 * arguments before it does, by looking at each value rather than at the
 * conversion that will consume it. That is where its defects came from: an
 * integer that happened to equal the address of a `char` printed as a string,
 * `%p` of a `char *` printed the characters, `%n` stored nothing, and an
 * unknown conversion wrote `(sprintf:error:%q)` into the program's output.
 *
 * This module is the formatting half of a C-conformant `printf`: a format and
 * arguments that already say what they are in, text and an account of every
 * directive out. The engine (`library/stdio.ts`) is the other half: it reads
 * the program's memory, so it is what decides that the argument `%s` consumes
 * is the string at an address, and it stores what `%n` counted.
 *
 * Nothing here imports the engine, so the same code runs in the format
 * playground the deploy writes as `c-stdio.js`.
 *
 * Where C leaves a choice to the implementation, this follows glibc on
 * x86-64 (LP64), which is what a course's Linux machines print:
 *
 *   - `%p` is `0x` and lowercase hexadecimal, and a null pointer is `(nil)`.
 *   - `%a` keeps the leading digit `1` for a normal number and `0` for a
 *     subnormal one, and prints exactly as many digits as the value needs.
 *   - Rounding is to nearest with ties to even, on the exact binary value.
 *
 * One departure: a NaN prints as `nan` whatever its sign bit, because a
 * JavaScript number does not reliably carry one.
 */

/** The flags a directive can carry, each at most once in effect. */
export interface FormatFlags {
  /** `-`: left-justify within the field. */
  minus: boolean;
  /** `+`: always print a sign for a signed conversion. */
  plus: boolean;
  /** ` `: print a space where a `+` would go. */
  space: boolean;
  /** `0`: pad numbers with leading zeros instead of spaces. */
  zero: boolean;
  /** `#`: the alternative form. */
  hash: boolean;
}

/** The length modifiers C defines for `printf`. */
export type LengthModifier =
  | ''
  | 'hh'
  | 'h'
  | 'l'
  | 'll'
  | 'j'
  | 'z'
  | 't'
  | 'L';

/** What a directive's argument is in, as the playground and the engine say it. */
export type PrintfArgumentKind =
  | 'int'
  | 'unsigned'
  | 'double'
  | 'char'
  | 'string'
  | 'pointer';

/**
 * One argument, already typed.
 *
 * `value` is a number, or a string: the characters for `string`, a single
 * character or a number for `char`, and for the numeric kinds a decimal (or
 * `0x` hexadecimal) integer too large for a JavaScript number to hold
 * exactly, or `inf`, `-inf`, `nan` for `double`.
 *
 * `bits` is the width of the argument's own type - 8 for `char`, 32 for `int`,
 * 64 for `long` - when the caller knows it. It is only used to say that a
 * conversion reads a different width than was passed.
 */
export interface PrintfArgument {
  kind: PrintfArgumentKind;
  value: number | string;
  bits?: number;
}

/** What went wrong with one directive. */
export interface PrintfDiagnostic {
  /** `unknown-conversion`, `missing-argument`, `argument-mismatch`, … */
  rule: string;
  severity: 'error' | 'warning';
  message: string;
}

/** A run of ordinary characters, copied to the output unchanged. */
export interface FormatLiteral {
  kind: 'literal';
  text: string;
  /** Offsets into the format: `format.slice(start, end) === text`. */
  start: number;
  end: number;
}

/** One conversion specification, `%-08.3lf`, read apart. */
export interface FormatDirective {
  kind: 'directive';
  /** The specification as the format writes it. */
  source: string;
  /** Offsets into the format: `format.slice(start, end) === source`. */
  start: number;
  end: number;
  flags: FormatFlags;
  /** The field width: a number, `*` for the next `int` argument, or null. */
  width: number | '*' | null;
  /** The precision: a number, `*` for the next `int` argument, or null. */
  precision: number | '*' | null;
  length: LengthModifier;
  /** The conversion character, or `''` when the format ends first. */
  conversion: string;
  /**
   * Why the directive cannot be carried out as written, when that can be told
   * from the format alone. An `error` problem means nothing is written for it
   * and it consumes no argument; a `warning` is formatted anyway.
   */
  problem?: PrintfDiagnostic;
}

export type FormatSegment = FormatLiteral | FormatDirective;

/** What one directive did. */
export interface DirectiveResult {
  directive: FormatDirective;
  /** The index of the argument it converted, or null when it took none. */
  argument: number | null;
  /** The index of the argument a `*` width came from. */
  widthArgument: number | null;
  /** The index of the argument a `*` precision came from. */
  precisionArgument: number | null;
  /** Where its text starts in the output; for `%n`, the count it stores. */
  offset: number;
  /** The text it produced, which is empty when it produced none. */
  text: string;
  diagnostic: PrintfDiagnostic | null;
}

export interface PrintfResult {
  text: string;
  directives: DirectiveResult[];
  /** Every directive's diagnostic, in order. */
  diagnostics: PrintfDiagnostic[];
  /** How many arguments no directive consumed. C ignores them. */
  unusedArguments: number;
}

export interface PrintfOptions {
  /** The function being described in messages: `printf`, `sprintf`, … */
  caller?: string;
}

/** Above this a width or precision is refused rather than allocated. */
export const FIELD_LIMIT = 4095;

const INTEGER_CONVERSIONS = 'diouxX';
const FLOAT_CONVERSIONS = 'eEfFgGaA';
const CONVERSIONS = 'diouxXeEfFgGaAcspn%';
const LENGTHS: LengthModifier[] = ['hh', 'h', 'll', 'l', 'j', 'z', 't', 'L'];

const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TWO = BigInt(2);
const BIG_FIVE = BigInt(5);
const BIG_TEN = BigInt(10);

/** The length modifiers each conversion accepts. `l` on `c` and `s` names the
 * wide forms, which this interpreter treats as the narrow ones. */
const ALLOWED_LENGTHS: Record<string, string[]> = {
  d: ['hh', 'h', 'l', 'll', 'j', 'z', 't'],
  i: ['hh', 'h', 'l', 'll', 'j', 'z', 't'],
  o: ['hh', 'h', 'l', 'll', 'j', 'z', 't'],
  u: ['hh', 'h', 'l', 'll', 'j', 'z', 't'],
  x: ['hh', 'h', 'l', 'll', 'j', 'z', 't'],
  X: ['hh', 'h', 'l', 'll', 'j', 'z', 't'],
  n: ['hh', 'h', 'l', 'll', 'j', 'z', 't'],
  e: ['l', 'L'],
  E: ['l', 'L'],
  f: ['l', 'L'],
  F: ['l', 'L'],
  g: ['l', 'L'],
  G: ['l', 'L'],
  a: ['l', 'L'],
  A: ['l', 'L'],
  c: ['l'],
  s: ['l'],
  p: [],
  '%': [],
};

const noFlags = (): FormatFlags => ({
  minus: false,
  plus: false,
  space: false,
  zero: false,
  hash: false,
});

/** The problem a directive has on its face, if any. */
const problemOf = (
  directive: Omit<FormatDirective, 'problem'>
): PrintfDiagnostic | undefined => {
  const { conversion, length, source } = directive;
  if (conversion === '') {
    return {
      rule: 'unknown-conversion',
      severity: 'error',
      message:
        `the format ends inside the conversion specification "${source}", ` +
        `which has no conversion character; its behavior is undefined, so ` +
        `nothing is written for it`,
    };
  }
  if (conversion === '$') {
    return {
      rule: 'unknown-conversion',
      severity: 'error',
      message:
        `"${source}" numbers its argument, which is a POSIX extension rather ` +
        `than ISO C; nothing is written for it`,
    };
  }
  if (CONVERSIONS.indexOf(conversion) === -1) {
    return {
      rule: 'unknown-conversion',
      severity: 'error',
      message:
        `%${conversion} is not a conversion C defines; the behavior of ` +
        `"${source}" is undefined, so nothing is written for it`,
    };
  }
  if (length !== '' && ALLOWED_LENGTHS[conversion].indexOf(length) === -1) {
    return {
      rule: 'invalid-length-modifier',
      severity: 'warning',
      message:
        `the length modifier ${length} does not apply to %${conversion}, so ` +
        `"${source}" has undefined behavior; it is formatted as %${conversion}`,
    };
  }
  return undefined;
};

/**
 * The format as literal runs and directives, in order. `%%` is a directive -
 * C calls it a conversion specification - that takes no argument.
 */
export function parseFormat(format: string): FormatSegment[] {
  const segments: FormatSegment[] = [];
  let literalStart = 0;
  let i = 0;
  const flushLiteral = (end: number) => {
    if (literalStart < end) {
      segments.push({
        kind: 'literal',
        text: format.slice(literalStart, end),
        start: literalStart,
        end,
      });
    }
  };
  while (i < format.length) {
    if (format[i] !== '%') {
      i += 1;
      continue;
    }
    flushLiteral(i);
    const start = i;
    let j = i + 1;
    const flags = noFlags();
    for (; j < format.length; j += 1) {
      const c = format[j];
      if (c === '-') {
        flags.minus = true;
      } else if (c === '+') {
        flags.plus = true;
      } else if (c === ' ') {
        flags.space = true;
      } else if (c === '0') {
        flags.zero = true;
      } else if (c === '#') {
        flags.hash = true;
      } else {
        break;
      }
    }
    let width: number | '*' | null = null;
    if (format[j] === '*') {
      width = '*';
      j += 1;
    } else {
      const digits = /^[0-9]+/.exec(format.slice(j));
      if (digits !== null) {
        width = Number(digits[0]);
        j += digits[0].length;
      }
    }
    let precision: number | '*' | null = null;
    if (format[j] === '.') {
      j += 1;
      if (format[j] === '*') {
        precision = '*';
        j += 1;
      } else {
        const digits = /^[0-9]*/.exec(format.slice(j));
        const text = digits === null ? '' : digits[0];
        precision = text === '' ? 0 : Number(text);
        j += text.length;
      }
    }
    let length: LengthModifier = '';
    for (const candidate of LENGTHS) {
      if (format.startsWith(candidate, j)) {
        length = candidate;
        j += candidate.length;
        break;
      }
    }
    const conversion = j < format.length ? format[j] : '';
    const end = conversion === '' ? j : j + 1;
    const directive: Omit<FormatDirective, 'problem'> = {
      kind: 'directive',
      source: format.slice(start, end),
      start,
      end,
      flags,
      width,
      precision,
      length,
      conversion,
    };
    const problem = problemOf(directive);
    segments.push(
      typeof problem === 'undefined' ? directive : { ...directive, problem }
    );
    i = end;
    literalStart = end;
  }
  flushLiteral(format.length);
  return segments;
}

/** The directives alone, for callers that do not need the literal runs. */
export const directivesOf = (segments: FormatSegment[]): FormatDirective[] =>
  segments.filter(
    (segment): segment is FormatDirective => segment.kind === 'directive'
  );

/**
 * The arguments a directive consumes, in the order it consumes them: a `*`
 * width, a `*` precision, then the value. A directive with an error problem
 * consumes none, and `%%` has no value.
 */
export function argumentSlots(
  directive: FormatDirective
): ('width' | 'precision' | 'value')[] {
  if (directive.problem?.severity === 'error') {
    return [];
  }
  const slots: ('width' | 'precision' | 'value')[] = [];
  if (directive.width === '*') {
    slots.push('width');
  }
  if (directive.precision === '*') {
    slots.push('precision');
  }
  if (directive.conversion !== '%') {
    slots.push('value');
  }
  return slots;
}

/** The kind of argument the engine should hand a conversion. */
export function argumentKindFor(conversion: string): PrintfArgumentKind {
  if ('di'.indexOf(conversion) !== -1) {
    return 'int';
  }
  if ('ouxX'.indexOf(conversion) !== -1) {
    return 'unsigned';
  }
  if (FLOAT_CONVERSIONS.indexOf(conversion) !== -1) {
    return 'double';
  }
  if (conversion === 'c') {
    return 'char';
  }
  if (conversion === 's') {
    return 'string';
  }
  return 'pointer';
}

/**
 * The width in bits a conversion converts its value to: C's wrap. `%hhu` of
 * 300 is 44 because the value is converted to `unsigned char` first.
 */
export function conversionBits(directive: FormatDirective): number {
  if (directive.conversion === 'c') {
    return 8;
  }
  switch (directive.length) {
    case 'hh':
      return 8;
    case 'h':
      return 16;
    case 'l':
    case 'll':
    case 'j':
    case 'z':
    case 't':
      return 64;
    default:
      return 32;
  }
}

/** The width an integer argument is passed with, after promotion. */
const passedBits = (directive: FormatDirective): number =>
  conversionBits(directive) === 64 ? 64 : 32;

/** Whether `%d` and `%i` read signed; everything else is unsigned. */
const isSigned = (conversion: string): boolean =>
  conversion === 'd' || conversion === 'i' || conversion === 'n';

const parseDouble = (value: number | string): number => {
  if (typeof value === 'number') {
    return value;
  }
  const text = value.trim();
  if (/^[+-]?inf(inity)?$/i.test(text)) {
    return text.startsWith('-') ? -Infinity : Infinity;
  }
  if (/^[+-]?nan$/i.test(text)) {
    return NaN;
  }
  if (/^[+-]?0x[0-9a-f]+$/i.test(text)) {
    const magnitude = Number(BigInt(text.replace(/^[+-]/, '')));
    return text.startsWith('-') ? -magnitude : magnitude;
  }
  return Number(text);
};

/** An integer value, exactly when the caller gave one too large for a number. */
const parseInteger = (argument: PrintfArgument): bigint => {
  const { value } = argument;
  if (typeof value === 'string') {
    // `'7'` is the character seven, not the number.
    if (argument.kind === 'char' && value.length === 1) {
      return BigInt(value.charCodeAt(0));
    }
    const text = value.trim();
    if (/^[+-]?[0-9]+$/.test(text)) {
      return BigInt(text);
    }
    if (/^[+-]?0x[0-9a-f]+$/i.test(text)) {
      const magnitude = BigInt(text.replace(/^[+-]/, ''));
      return text.startsWith('-') ? -magnitude : magnitude;
    }
  }
  const number = parseDouble(value);
  return Number.isFinite(number) ? BigInt(Math.trunc(number)) : BIG_ZERO;
};

const wrap = (value: bigint, bits: number, signed: boolean): bigint =>
  signed ? BigInt.asIntN(bits, value) : BigInt.asUintN(bits, value);

/** `body` padded to `width`, on the left unless the field is left-justified. */
const pad = (body: string, width: number, left: boolean): string => {
  if (body.length >= width) {
    return body;
  }
  const fill = ' '.repeat(width - body.length);
  return left ? body + fill : fill + body;
};

/**
 * A sign or prefix, zeros, then digits, padded to the field. Zeros go after
 * the sign and the `0x`, which is why the three are kept apart until here.
 */
const field = (
  prefix: string,
  digits: string,
  width: number,
  flags: FormatFlags,
  zeroPad: boolean
): string => {
  if (zeroPad && !flags.minus && prefix.length + digits.length < width) {
    return prefix + '0'.repeat(width - prefix.length - digits.length) + digits;
  }
  return pad(prefix + digits, width, flags.minus);
};

const signOf = (negative: boolean, flags: FormatFlags): string => {
  if (negative) {
    return '-';
  }
  if (flags.plus) {
    return '+';
  }
  return flags.space ? ' ' : '';
};

function formatInteger(
  value: bigint,
  directive: FormatDirective,
  width: number,
  precision: number | null
): string {
  const { conversion, flags } = directive;
  const bits = conversionBits(directive);
  const signed = isSigned(conversion);
  const wrapped = wrap(value, bits, signed);
  const negative = wrapped < BIG_ZERO;
  const magnitude = negative ? -wrapped : wrapped;
  const radix =
    conversion === 'o' ? 8 : 'xX'.indexOf(conversion) !== -1 ? 16 : 10;
  let digits =
    precision === 0 && magnitude === BIG_ZERO ? '' : magnitude.toString(radix);
  if (conversion === 'X') {
    digits = digits.toUpperCase();
  }
  if (precision !== null && digits.length < precision) {
    digits = '0'.repeat(precision - digits.length) + digits;
  }
  let prefix = signed ? signOf(negative, flags) : '';
  if (flags.hash) {
    if (conversion === 'o' && !digits.startsWith('0')) {
      digits = '0' + digits;
    } else if (conversion === 'x' && magnitude !== BIG_ZERO) {
      prefix = '0x';
    } else if (conversion === 'X' && magnitude !== BIG_ZERO) {
      prefix = '0X';
    }
  }
  return field(prefix, digits, width, flags, flags.zero && precision === null);
}

/** A finite, non-negative double as an exact decimal: `digits / 10^scale`. */
interface Exact {
  digits: bigint;
  scale: number;
}

const bitsOf = (value: number): { exponent: number; fraction: bigint } => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const high = view.getUint32(0);
  const low = view.getUint32(4);
  return {
    exponent: (high >>> 20) & 0x7ff,
    fraction: (BigInt(high & 0xfffff) << BigInt(32)) | BigInt(low),
  };
};

const exactOf = (value: number): Exact => {
  const { exponent, fraction } = bitsOf(value);
  const mantissa =
    exponent === 0 ? fraction : fraction | (BIG_ONE << BigInt(52));
  const power = (exponent === 0 ? 1 : exponent) - 1075;
  if (power >= 0) {
    return { digits: mantissa << BigInt(power), scale: 0 };
  }
  return { digits: mantissa * BIG_FIVE ** BigInt(-power), scale: -power };
};

/** `numerator / divisor` rounded to nearest, ties to even. */
const divideRounded = (numerator: bigint, divisor: bigint): bigint => {
  const quotient = numerator / divisor;
  const twice = (numerator % divisor) * BIG_TWO;
  if (
    twice > divisor ||
    (twice === divisor && quotient % BIG_TWO !== BIG_ZERO)
  ) {
    return quotient + BIG_ONE;
  }
  return quotient;
};

/** The value scaled by `10^places` and rounded: the digits `%.<places>f` prints. */
const roundedFixed = (exact: Exact, places: number): bigint => {
  if (places >= exact.scale) {
    return exact.digits * BIG_TEN ** BigInt(places - exact.scale);
  }
  return divideRounded(exact.digits, BIG_TEN ** BigInt(exact.scale - places));
};

/** Inserts a decimal point `places` digits from the right. */
const withPoint = (digits: bigint, places: number, hash: boolean): string => {
  let text = digits.toString();
  if (places === 0) {
    return hash ? `${text}.` : text;
  }
  if (text.length <= places) {
    text = '0'.repeat(places - text.length + 1) + text;
  }
  return `${text.slice(0, text.length - places)}.${text.slice(text.length - places)}`;
};

const fixed = (value: number, places: number, hash: boolean): string =>
  withPoint(roundedFixed(exactOf(value), places), places, hash);

/**
 * `significant` digits of the value, rounded, and the decimal exponent of the
 * first one: what `%e` prints before and after the `e`.
 */
const roundedScientific = (
  value: number,
  significant: number
): { digits: string; exponent: number } => {
  if (value === 0) {
    return { digits: '0'.repeat(significant), exponent: 0 };
  }
  const exact = exactOf(value);
  const text = exact.digits.toString();
  let exponent = text.length - 1 - exact.scale;
  let digits: bigint;
  if (text.length > significant) {
    digits = divideRounded(
      exact.digits,
      BIG_TEN ** BigInt(text.length - significant)
    );
  } else {
    digits = exact.digits * BIG_TEN ** BigInt(significant - text.length);
  }
  let result = digits.toString();
  if (result.length > significant) {
    // 9.99 rounded to two digits is 10.0: one more digit, one more power.
    result = result.slice(0, significant);
    exponent += 1;
  }
  return { digits: result, exponent };
};

const exponentText = (exponent: number, letter: string): string =>
  `${letter}${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;

const scientific = (
  value: number,
  places: number,
  hash: boolean,
  letter: string
): string => {
  const { digits, exponent } = roundedScientific(value, places + 1);
  const mantissa =
    places === 0
      ? `${digits}${hash ? '.' : ''}`
      : `${digits[0]}.${digits.slice(1)}`;
  return mantissa + exponentText(exponent, letter);
};

const general = (
  value: number,
  precision: number,
  hash: boolean,
  letter: string
): string => {
  const significant = precision === 0 ? 1 : precision;
  const { exponent } = roundedScientific(value, significant);
  let text =
    significant > exponent && exponent >= -4
      ? fixed(value, significant - 1 - exponent, hash)
      : scientific(value, significant - 1, hash, letter);
  if (!hash) {
    // Trailing zeros go, and the point with them when nothing is left after it.
    const at = text.indexOf(letter);
    const mantissa = at === -1 ? text : text.slice(0, at);
    const tail = at === -1 ? '' : text.slice(at);
    const trimmed =
      mantissa.indexOf('.') === -1
        ? mantissa
        : mantissa.replace(/0+$/, '').replace(/\.$/, '');
    text = trimmed + tail;
  }
  return text;
};

const hexFloat = (
  value: number,
  precision: number | null,
  hash: boolean
): string => {
  const { exponent: biased, fraction } = bitsOf(value);
  let lead: bigint;
  let exponent: number;
  if (value === 0) {
    lead = BIG_ZERO;
    exponent = 0;
  } else if (biased === 0) {
    lead = BIG_ZERO;
    exponent = -1022;
  } else {
    lead = BIG_ONE;
    exponent = biased - 1023;
  }
  let digits = fraction.toString(16).padStart(13, '0');
  if (precision === null) {
    digits = digits.replace(/0+$/, '');
  } else if (precision < 13) {
    const shift = BigInt((13 - precision) * 4);
    const whole = (lead << BigInt(52)) | fraction;
    const divisor = BIG_ONE << shift;
    let kept = whole / divisor;
    const twice = (whole % divisor) * BIG_TWO;
    // glibc breaks a tie towards the digit whose character code is even, so
    // `a` to `f` count the other way round from their values. Matching it is
    // the point of the exercise: this is what the course machines print.
    const last = Number(kept & BigInt(15));
    const odd = last < 10 ? last % 2 === 1 : last % 2 === 0;
    if (twice > divisor || (twice === divisor && odd)) {
      kept += BIG_ONE;
    }
    const fractionBits = BigInt(precision * 4);
    lead = kept >> fractionBits;
    digits =
      precision === 0
        ? ''
        : (kept & ((BIG_ONE << fractionBits) - BIG_ONE))
            .toString(16)
            .padStart(precision, '0');
  } else {
    digits += '0'.repeat(precision - 13);
  }
  const point = digits !== '' || hash ? '.' : '';
  return `0x${lead.toString(16)}${point}${digits}p${exponent < 0 ? '-' : '+'}${Math.abs(exponent)}`;
};

function formatFloat(
  value: number,
  directive: FormatDirective,
  width: number,
  precision: number | null
): string {
  const { conversion, flags } = directive;
  const upper = conversion === conversion.toUpperCase();
  const negative = value < 0 || Object.is(value, -0);
  const magnitude = Math.abs(value);
  const sign = signOf(negative && !Number.isNaN(value), flags);
  if (!Number.isFinite(magnitude)) {
    const word = Number.isNaN(magnitude) ? 'nan' : 'inf';
    // Zeros never pad an infinity: `%05f` of it is `  inf`.
    return pad(sign + (upper ? word.toUpperCase() : word), width, flags.minus);
  }
  const lower = conversion.toLowerCase();
  let body: string;
  if (lower === 'f') {
    body = fixed(magnitude, precision ?? 6, flags.hash);
  } else if (lower === 'e') {
    body = scientific(magnitude, precision ?? 6, flags.hash, 'e');
  } else if (lower === 'g') {
    body = general(magnitude, precision ?? 6, flags.hash, 'e');
  } else {
    body = hexFloat(magnitude, precision, flags.hash);
  }
  let prefix = sign;
  if (lower === 'a') {
    // The `0x` is part of the prefix so that zeros pad after it.
    prefix += body.slice(0, 2);
    body = body.slice(2);
  }
  if (upper) {
    prefix = prefix.toUpperCase();
    body = body.toUpperCase();
  }
  return field(prefix, body, width, flags, flags.zero);
}

const NAMES: Record<PrintfArgumentKind, string> = {
  int: 'an int',
  unsigned: 'an unsigned int',
  double: 'a double',
  char: 'a char',
  string: 'a string',
  pointer: 'a pointer',
};

/** What a conversion's argument must be, said the way a message needs it. */
const wantedFor = (directive: FormatDirective): string => {
  const { conversion } = directive;
  if (INTEGER_CONVERSIONS.indexOf(conversion) !== -1) {
    return `an integer of type ${integerType(directive)}`;
  }
  if (FLOAT_CONVERSIONS.indexOf(conversion) !== -1) {
    return directive.length === 'L' ? 'a long double' : 'a double';
  }
  if (conversion === 'c') {
    return 'a character code (an int)';
  }
  if (conversion === 's') {
    return 'a pointer to a string';
  }
  if (conversion === 'n') {
    return `a pointer to ${integerType(directive)}`;
  }
  return 'a pointer (void *)';
};

/**
 * Whether an argument of this kind is what the conversion reads. `null` is a
 * match; otherwise the diagnostic, which is an error when nothing sensible
 * can be printed and a warning when the value can still be shown.
 */
const mismatchOf = (
  directive: FormatDirective,
  argument: PrintfArgument,
  caller: string
): PrintfDiagnostic | null => {
  const { conversion, source } = directive;
  const { kind } = argument;
  const integral = kind === 'int' || kind === 'unsigned' || kind === 'char';
  let fits: boolean;
  let printable: boolean;
  if (INTEGER_CONVERSIONS.indexOf(conversion) !== -1 || conversion === 'c') {
    fits = integral;
    printable = kind !== 'string';
  } else if (FLOAT_CONVERSIONS.indexOf(conversion) !== -1) {
    fits = kind === 'double';
    printable = kind !== 'string';
  } else if (conversion === 's') {
    fits = kind === 'string';
    printable = fits;
  } else {
    // %p and %n: an address.
    fits = kind === 'pointer';
    printable = kind !== 'string' && kind !== 'double';
  }
  if (fits) {
    const width = argument.bits;
    if (
      typeof width === 'number' &&
      INTEGER_CONVERSIONS.indexOf(conversion) !== -1 &&
      Math.max(width, 32) !== passedBits(directive)
    ) {
      return {
        rule: 'argument-mismatch',
        severity: 'warning',
        message:
          `${source} reads ${wantedFor(directive)}, but this argument is ` +
          `${width} bits wide; the mismatch has undefined behavior`,
      };
    }
    return null;
  }
  return {
    rule: 'argument-mismatch',
    severity: printable ? 'warning' : 'error',
    message:
      `${source} requires ${wantedFor(directive)}, but the argument ${caller} ` +
      `was given is ${NAMES[kind]}; the mismatch has undefined behavior` +
      (printable ? '' : ', so nothing is written for it'),
  };
};

const fieldProblem = (
  directive: FormatDirective,
  what: 'width' | 'precision',
  value: number
): PrintfDiagnostic | null =>
  value > FIELD_LIMIT
    ? {
        rule: 'field-too-wide',
        severity: 'error',
        message:
          `the ${what} ${value} in ${directive.source} is more than this ` +
          `formatter handles (${FIELD_LIMIT}); nothing is written for it`,
      }
    : null;

/** The argument's value as an `int`, which is what `*` reads. */
const starValue = (argument: PrintfArgument): number =>
  Number(BigInt.asIntN(32, parseInteger(argument)));

/**
 * Formats `args` by `format`.
 *
 * Every directive is reported, including those that wrote nothing. A
 * directive whose argument is missing, or that is not a conversion C
 * defines, writes nothing and carries an error diagnostic; the rest of the
 * format is still formatted, so one mistake does not hide the output around
 * it.
 */
export function formatPrintf(
  format: string,
  args: PrintfArgument[],
  options: PrintfOptions = {}
): PrintfResult {
  const caller = options.caller ?? 'printf';
  const segments = parseFormat(format);
  const directives: DirectiveResult[] = [];
  let text = '';
  let next = 0;

  for (const segment of segments) {
    if (segment.kind === 'literal') {
      text += segment.text;
      continue;
    }
    const result: DirectiveResult = {
      directive: segment,
      argument: null,
      widthArgument: null,
      precisionArgument: null,
      offset: text.length,
      text: '',
      diagnostic: segment.problem ?? null,
    };
    directives.push(result);
    if (segment.problem?.severity === 'error') {
      continue;
    }

    let width = typeof segment.width === 'number' ? segment.width : 0;
    let precision =
      typeof segment.precision === 'number' ? segment.precision : null;
    let flags = segment.flags;
    let missing = false;
    for (const slot of argumentSlots(segment)) {
      if (args.length <= next) {
        missing = true;
        break;
      }
      const index = next;
      next += 1;
      if (slot === 'width') {
        result.widthArgument = index;
        const given = starValue(args[index]);
        // A negative width is a `-` flag and a positive width.
        if (given < 0) {
          flags = { ...flags, minus: true };
        }
        width = Math.abs(given);
      } else if (slot === 'precision') {
        result.precisionArgument = index;
        const given = starValue(args[index]);
        // A negative precision is taken as if it were omitted.
        precision = given < 0 ? null : given;
      } else {
        result.argument = index;
      }
    }
    if (missing) {
      result.diagnostic = {
        rule: 'missing-argument',
        severity: 'error',
        message:
          `${segment.source} has no corresponding argument; ${caller} would ` +
          `read one that was never passed, which has undefined behavior, so ` +
          `nothing is written for it`,
      };
      continue;
    }
    const tooWide =
      fieldProblem(segment, 'width', width) ??
      (precision === null
        ? null
        : fieldProblem(segment, 'precision', precision));
    if (tooWide !== null) {
      result.diagnostic = tooWide;
      continue;
    }

    const directive: FormatDirective =
      flags === segment.flags ? segment : { ...segment, flags };
    if (directive.conversion === '%') {
      result.text = '%';
      text += '%';
      continue;
    }
    const argument = args[result.argument as number];
    const mismatch = mismatchOf(directive, argument, caller);
    if (mismatch !== null) {
      result.diagnostic = result.diagnostic ?? mismatch;
      if (mismatch.severity === 'error') {
        result.diagnostic = mismatch;
        continue;
      }
    }
    result.text = formatOne(directive, argument, width, precision);
    text += result.text;
  }

  return {
    text,
    directives,
    diagnostics: directives
      .map((one) => one.diagnostic)
      .filter((one): one is PrintfDiagnostic => one !== null),
    unusedArguments: Math.max(0, args.length - next),
  };
}

/** One directive's text, once its argument is known to be printable. */
function formatOne(
  directive: FormatDirective,
  argument: PrintfArgument,
  width: number,
  precision: number | null
): string {
  const { conversion, flags } = directive;
  if (INTEGER_CONVERSIONS.indexOf(conversion) !== -1) {
    return formatInteger(parseInteger(argument), directive, width, precision);
  }
  if (FLOAT_CONVERSIONS.indexOf(conversion) !== -1) {
    const value =
      argument.kind === 'double'
        ? parseDouble(argument.value)
        : Number(parseInteger(argument));
    return formatFloat(value, directive, width, precision);
  }
  if (conversion === 'c') {
    const code = Number(BigInt.asUintN(8, parseInteger(argument)));
    return pad(String.fromCharCode(code), width, flags.minus);
  }
  if (conversion === 's') {
    const value = String(argument.value);
    return pad(
      precision === null ? value : value.slice(0, precision),
      width,
      flags.minus
    );
  }
  if (conversion === 'p') {
    const address = BigInt.asUintN(64, parseInteger(argument));
    return pad(
      address === BIG_ZERO ? '(nil)' : `0x${address.toString(16)}`,
      width,
      flags.minus
    );
  }
  // %n writes nothing; what it stores is the directive's offset.
  return '';
}

/** The value `%n` stores, wrapped to the type its length modifier names. */
export function countStoredBy(
  directive: FormatDirective,
  count: number
): number {
  return Number(BigInt.asIntN(conversionBits(directive), BigInt(count)));
}

/** The integer type a conversion reads, by its length modifier. */
function integerType(directive: FormatDirective): string {
  const signed = isSigned(directive.conversion);
  switch (directive.length) {
    case 'hh':
      return signed ? 'signed char' : 'unsigned char';
    case 'h':
      return signed ? 'short' : 'unsigned short';
    case 'l':
      return signed ? 'long' : 'unsigned long';
    case 'll':
      return signed ? 'long long' : 'unsigned long long';
    case 'j':
      return signed ? 'intmax_t' : 'uintmax_t';
    case 'z':
      return signed ? 'the signed type of size_t' : 'size_t';
    case 't':
      return signed ? 'ptrdiff_t' : 'the unsigned type of ptrdiff_t';
    default:
      return signed ? 'int' : 'unsigned int';
  }
}

const CONVERSION_TEXT: Record<string, string> = {
  d: 'a signed integer in decimal',
  i: 'a signed integer in decimal',
  u: 'an unsigned integer in decimal',
  o: 'an unsigned integer in octal',
  x: 'an unsigned integer in lowercase hexadecimal',
  X: 'an unsigned integer in uppercase hexadecimal',
  f: 'a floating-point number in fixed-point notation (ddd.ddd)',
  F: 'a floating-point number in fixed-point notation, with INF and NAN in capitals',
  e: 'a floating-point number in exponential notation (d.ddde+dd)',
  E: 'a floating-point number in exponential notation (d.dddE+dd)',
  g: 'a floating-point number in fixed-point or exponential notation, whichever suits its magnitude, without trailing zeros',
  G: 'a floating-point number like %g, with E, INF and NAN in capitals',
  a: 'a floating-point number in hexadecimal exponential notation (0x1.hhhp+d)',
  A: 'a floating-point number in hexadecimal exponential notation, in capitals',
  c: 'one character: the int argument converted to unsigned char',
  s: 'the characters of a string, up to its terminating null character',
  p: 'a pointer, as an address in hexadecimal',
};

const precisionText = (directive: FormatDirective, value: string): string => {
  const { conversion } = directive;
  if (INTEGER_CONVERSIONS.indexOf(conversion) !== -1) {
    return `at least ${value} digits, with leading zeros as needed`;
  }
  if ('fFeEaA'.indexOf(conversion) !== -1) {
    return `${value} digits after the decimal point`;
  }
  if ('gG'.indexOf(conversion) !== -1) {
    return `at most ${value} significant digits`;
  }
  if (conversion === 's') {
    return `at most ${value} characters of the string`;
  }
  return '';
};

const hashText = (conversion: string): string => {
  switch (conversion) {
    case 'o':
      return 'the alternative form (#) starts the number with 0';
    case 'x':
      return 'the alternative form (#) puts 0x before a nonzero value';
    case 'X':
      return 'the alternative form (#) puts 0X before a nonzero value';
    case 'g':
    case 'G':
      return 'the alternative form (#) keeps the trailing zeros and the decimal point';
    case 'f':
    case 'F':
    case 'e':
    case 'E':
    case 'a':
    case 'A':
      return 'the alternative form (#) always prints the decimal point';
    default:
      return '';
  }
};

/**
 * The directive in plain English, for the format playground: what it prints,
 * what argument it reads, and what each flag, the width and the precision do.
 */
export function explainDirective(directive: FormatDirective): string {
  const { conversion, flags, width, precision, length, source } = directive;
  if (directive.problem?.severity === 'error') {
    return `${source}: ${directive.problem.message}.`;
  }
  if (conversion === '%') {
    return `${source} prints a single % character and takes no argument.`;
  }
  if (conversion === 'n') {
    return (
      `${source} prints nothing. It stores the number of characters written ` +
      `so far through its argument, which must be a pointer to ` +
      `${integerType(directive)}.`
    );
  }
  const sentences: string[] = [];
  let reads: string;
  if (INTEGER_CONVERSIONS.indexOf(conversion) !== -1) {
    reads = integerType(directive);
  } else if (FLOAT_CONVERSIONS.indexOf(conversion) !== -1) {
    reads =
      length === 'L'
        ? 'long double'
        : 'double (a float argument is promoted to double)';
  } else if (conversion === 'c') {
    reads = 'int';
  } else if (conversion === 's') {
    reads = 'char * pointing to a null-terminated string';
  } else {
    reads = 'void *';
  }
  sentences.push(
    `${source} prints ${CONVERSION_TEXT[conversion]}, reading an argument of type ${reads}.`
  );
  if (length === 'l' && FLOAT_CONVERSIONS.indexOf(conversion) !== -1) {
    sentences.push(`The l modifier has no effect on %${conversion}.`);
  }
  if (length === 'l' && (conversion === 'c' || conversion === 's')) {
    sentences.push(
      `The l modifier names a wide character${conversion === 's' ? ' string' : ''}; this interpreter has none, so it is read as the narrow form.`
    );
  }
  if (directive.problem !== undefined) {
    sentences.push(`Note: ${directive.problem.message}.`);
  }
  if (width === '*') {
    sentences.push(
      'The minimum field width comes from an int argument before the value; a negative one left-justifies.'
    );
  } else if (width !== null) {
    sentences.push(`The field is at least ${width} characters wide.`);
  }
  if (width !== null) {
    if (flags.minus) {
      sentences.push('The - flag left-justifies it, padding on the right.');
    } else if (
      flags.zero &&
      (FLOAT_CONVERSIONS.indexOf(conversion) !== -1 ||
        (INTEGER_CONVERSIONS.indexOf(conversion) !== -1 && precision === null))
    ) {
      sentences.push(
        'The 0 flag pads it with leading zeros instead of spaces.'
      );
    } else {
      sentences.push('It is right-justified, padded with spaces on the left.');
    }
  }
  if (precision === '*') {
    sentences.push(
      'The precision comes from an int argument before the value; a negative one counts as no precision.'
    );
  } else if (precision !== null) {
    const said = precisionText(directive, String(precision));
    if (precision === 0 && INTEGER_CONVERSIONS.indexOf(conversion) !== -1) {
      sentences.push(
        'The precision is 0, so a value of 0 prints no digits at all.'
      );
    } else if (said !== '') {
      sentences.push(`The precision asks for ${said}.`);
    }
  } else if ('fFeE'.indexOf(conversion) !== -1) {
    sentences.push(
      'With no precision it prints 6 digits after the decimal point.'
    );
  } else if ('gG'.indexOf(conversion) !== -1) {
    sentences.push('With no precision it uses 6 significant digits.');
  }
  const signed =
    'di'.indexOf(conversion) !== -1 ||
    FLOAT_CONVERSIONS.indexOf(conversion) !== -1;
  if (signed && flags.plus) {
    sentences.push('The + flag always prints a sign.');
  } else if (signed && flags.space) {
    sentences.push('The space flag prints a space where a + sign would go.');
  }
  if (flags.hash) {
    const said = hashText(conversion);
    if (said !== '') {
      sentences.push(`${said[0].toUpperCase()}${said.slice(1)}.`);
    }
  }
  if (INTEGER_CONVERSIONS.indexOf(conversion) !== -1) {
    const bits = conversionBits(directive);
    if (bits < 32) {
      sentences.push(
        `The value is converted to ${integerType(directive)} first, so it wraps at ${bits} bits.`
      );
    }
  }
  return sentences.join(' ');
}
