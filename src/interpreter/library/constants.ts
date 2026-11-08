import { DATA_MODEL } from './types';

/**
 * The object-like macros the library headers define, with their values.
 *
 * Pure data: the engine installs each one as a system variable, the way the
 * stock engine installs `NULL`, and `libraryHelp` reads the same rows for
 * completion and hover help, so the value a program computes with and the
 * value the editor names cannot drift apart.
 *
 * A macro becomes a variable rather than a preprocessor definition because
 * the engine's integer constants go through `v | 0`: `UINT_MAX` written out
 * as `4294967295` would execute as -1, and `NAN` has no spelling as a
 * constant at all. A value is stored as the engine's `Int` when it fits a
 * signed 32-bit `int`, which keeps C's integer division and wrap-around, and
 * as a plain number otherwise. The undeclared-identifier rule already exempts
 * any name spelled in macro case, so none of these needs a lint exception.
 *
 * Integer widths follow `DATA_MODEL` (see `types.ts`). The `long long`
 * limits are the 64-bit values C requires, which this engine - whose
 * `long long` is reduced to a 32-bit `long` - can name but not hold exactly
 * above 2^53.
 */

export type ConstantType = 'int' | 'unsigned' | 'long' | 'double';

export interface LibraryConstant {
  header: string;
  value: number;
  /** The type the macro's replacement has in C. */
  type: ConstantType;
  /** How the replacement is spelled in a hosted implementation's header. */
  spelling: string;
  description: string;
}

const LP64 = DATA_MODEL === 'LP64';

/** 2^63 - 1 and friends, as near as a double comes. */
const LLONG_MAX = Number('9223372036854775807');
const ULLONG_MAX = Number('18446744073709551615');

const limit = (
  value: number,
  type: ConstantType,
  spelling: string,
  description: string
): LibraryConstant => ({
  header: 'limits.h',
  value,
  type,
  spelling,
  description,
});

const float = (
  value: number,
  type: ConstantType,
  spelling: string,
  description: string
): LibraryConstant => ({
  header: 'float.h',
  value,
  type,
  spelling,
  description,
});

export const LIBRARY_CONSTANTS: Record<string, LibraryConstant> = {
  CHAR_BIT: limit(8, 'int', '8', 'the number of bits in a char (a byte)'),
  SCHAR_MIN: limit(-128, 'int', '(-128)', 'the minimum value of signed char'),
  SCHAR_MAX: limit(127, 'int', '127', 'the maximum value of signed char'),
  UCHAR_MAX: limit(255, 'int', '255', 'the maximum value of unsigned char'),
  CHAR_MIN: limit(
    -128,
    'int',
    '(-128)',
    'the minimum value of char, which is signed in this implementation'
  ),
  CHAR_MAX: limit(
    127,
    'int',
    '127',
    'the maximum value of char, which is signed in this implementation'
  ),
  SHRT_MIN: limit(-32768, 'int', '(-32768)', 'the minimum value of short'),
  SHRT_MAX: limit(32767, 'int', '32767', 'the maximum value of short'),
  USHRT_MAX: limit(
    65535,
    'int',
    '65535',
    'the maximum value of unsigned short'
  ),
  INT_MIN: limit(
    -2147483648,
    'int',
    '(-2147483647 - 1)',
    'the minimum value of int'
  ),
  INT_MAX: limit(2147483647, 'int', '2147483647', 'the maximum value of int'),
  UINT_MAX: limit(
    4294967295,
    'unsigned',
    '4294967295U',
    'the maximum value of unsigned int'
  ),
  LONG_MIN: limit(
    LP64 ? -LLONG_MAX - 1 : -2147483648,
    'long',
    LP64 ? '(-9223372036854775807L - 1)' : '(-2147483647L - 1)',
    'the minimum value of long'
  ),
  LONG_MAX: limit(
    LP64 ? LLONG_MAX : 2147483647,
    'long',
    LP64 ? '9223372036854775807L' : '2147483647L',
    'the maximum value of long'
  ),
  ULONG_MAX: limit(
    LP64 ? ULLONG_MAX : 4294967295,
    'unsigned',
    LP64 ? '18446744073709551615UL' : '4294967295UL',
    'the maximum value of unsigned long'
  ),
  LLONG_MIN: limit(
    -LLONG_MAX - 1,
    'long',
    '(-9223372036854775807LL - 1)',
    'the minimum value of long long'
  ),
  LLONG_MAX: limit(
    LLONG_MAX,
    'long',
    '9223372036854775807LL',
    'the maximum value of long long'
  ),
  ULLONG_MAX: limit(
    ULLONG_MAX,
    'unsigned',
    '18446744073709551615ULL',
    'the maximum value of unsigned long long'
  ),

  FLT_MIN: float(
    2 ** -126,
    'double',
    '1.17549435e-38F',
    'the smallest positive normalized float'
  ),
  FLT_MAX: float(
    (2 - 2 ** -23) * 2 ** 127,
    'double',
    '3.40282347e+38F',
    'the largest finite float'
  ),
  FLT_EPSILON: float(
    2 ** -23,
    'double',
    '1.19209290e-07F',
    'the difference between 1 and the next float after it'
  ),
  FLT_DIG: float(
    6,
    'int',
    '6',
    'the number of decimal digits a float is guaranteed to preserve'
  ),
  DBL_MIN: float(
    2 ** -1022,
    'double',
    '2.2250738585072014e-308',
    'the smallest positive normalized double'
  ),
  DBL_MAX: float(
    Number.MAX_VALUE,
    'double',
    '1.7976931348623157e+308',
    'the largest finite double'
  ),
  DBL_EPSILON: float(
    Number.EPSILON,
    'double',
    '2.2204460492503131e-16',
    'the difference between 1 and the next double after it'
  ),
  DBL_DIG: float(
    15,
    'int',
    '15',
    'the number of decimal digits a double is guaranteed to preserve'
  ),

  EDOM: {
    header: 'errno.h',
    value: 33,
    type: 'int',
    spelling: '33',
    description:
      'errno value for a domain error: an argument outside the set a mathematical function is defined on',
  },
  ERANGE: {
    header: 'errno.h',
    value: 34,
    type: 'int',
    spelling: '34',
    description:
      'errno value for a range error: a result too large or too small for its type',
  },
  EINVAL: {
    header: 'errno.h',
    value: 22,
    type: 'int',
    spelling: '22',
    description: 'errno value for an invalid argument',
  },
  ENOENT: {
    header: 'errno.h',
    value: 2,
    type: 'int',
    spelling: '2',
    description: 'errno value for a file or directory that does not exist',
  },

  EXIT_SUCCESS: {
    header: 'stdlib.h',
    value: 0,
    type: 'int',
    spelling: '0',
    description: 'the status exit and main return to report success',
  },
  EXIT_FAILURE: {
    header: 'stdlib.h',
    value: 1,
    type: 'int',
    spelling: '1',
    description: 'the status exit and main return to report failure',
  },
  RAND_MAX: {
    header: 'stdlib.h',
    value: 32767,
    type: 'int',
    spelling: '32767',
    description: 'the largest value rand returns',
  },

  CLOCKS_PER_SEC: {
    header: 'time.h',
    value: 1000000,
    type: 'long',
    spelling: '1000000L',
    description: 'the number of clock_t units clock counts per second',
  },

  NAN: {
    header: 'math.h',
    value: NaN,
    type: 'double',
    spelling: '(__builtin_nanf(""))',
    description: 'a quiet not-a-number floating value',
  },
  INFINITY: {
    header: 'math.h',
    value: Infinity,
    type: 'double',
    spelling: '(__builtin_inff())',
    description: 'positive infinity as a floating value',
  },
  HUGE_VAL: {
    header: 'math.h',
    value: Infinity,
    type: 'double',
    spelling: '(__builtin_huge_val())',
    description:
      'the value a double function returns on overflow; positive infinity here',
  },
};

/** Whether a constant's value is stored as the engine's 32-bit `Int`. */
export const isIntConstant = (constant: LibraryConstant): boolean =>
  constant.type !== 'double' &&
  constant.type !== 'unsigned' &&
  Number.isInteger(constant.value) &&
  constant.value >= -2147483648 &&
  constant.value <= 2147483647;
