import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { LIBRARY_CONSTANTS } from './constants';
import { LibraryHost } from './host';
import {
  Memory,
  StringArg,
  cInt,
  cWide,
  decodeValue,
  num,
  sizeArg,
} from './memory';
import { LONG_BYTES, RECORD_TYPEDEFS } from './types';
import { Engine } from 'unicoen.ts/dist/interpreter/Engine/Engine';

/**
 * `<stdlib.h>`: `calloc`, the string conversions, the integer arithmetic,
 * the random-number generator and `exit`.
 *
 * Integer results come back as the engine's `Int` so C's integer division
 * applies to them (`atoi("7") / 2` is 3, not 3.5). The conversions follow
 * C11 7.22.1 to the letter - leading white space, a sign, `0x` and `0`
 * prefixes for base 0, the end pointer, and `ERANGE` with the clamped value
 * on overflow - because "it returned a number" is not the same as "it
 * behaved like strtol".
 */

const ERANGE = LIBRARY_CONSTANTS.ERANGE.value;
const EINVAL = LIBRARY_CONSTANTS.EINVAL.value;
const EXIT_FAILURE = LIBRARY_CONSTANTS.EXIT_FAILURE.value;

const isSpace = (c: number): boolean => c === 32 || (9 <= c && c <= 13);

/** The value of a digit in bases up to 36, or -1. */
const digitValue = (c: number): number => {
  if (48 <= c && c <= 57) {
    return c - 48;
  }
  if (97 <= c && c <= 122) {
    return c - 87;
  }
  if (65 <= c && c <= 90) {
    return c - 55;
  }
  return -1;
};

/** One integer conversion: the magnitude, its sign, and where it ended. */
interface ParsedInteger {
  magnitude: bigint;
  negative: boolean;
  /** Characters consumed; 0 when there was no number to convert. */
  end: number;
}

/** C11 7.22.1.4: the subject sequence of `strtol` and its family. */
export function parseInteger(bytes: number[], base: number): ParsedInteger {
  let i = 0;
  while (i < bytes.length && isSpace(bytes[i])) {
    i += 1;
  }
  let negative = false;
  if (bytes[i] === 43 || bytes[i] === 45) {
    negative = bytes[i] === 45;
    i += 1;
  }
  let radix = base;
  const hexPrefix =
    bytes[i] === 48 &&
    (bytes[i + 1] === 120 || bytes[i + 1] === 88) &&
    0 <= digitValue(bytes[i + 2] ?? -1) &&
    digitValue(bytes[i + 2]) < 16;
  if ((radix === 0 || radix === 16) && hexPrefix) {
    i += 2;
    radix = 16;
  } else if (radix === 0) {
    radix = bytes[i] === 48 ? 8 : 10;
  }
  const start = i;
  let magnitude = BigInt(0);
  while (i < bytes.length) {
    const digit = digitValue(bytes[i]);
    if (digit < 0 || radix <= digit) {
      break;
    }
    magnitude = magnitude * BigInt(radix) + BigInt(digit);
    i += 1;
  }
  return i === start
    ? { magnitude: BigInt(0), negative: false, end: 0 }
    : { magnitude, negative, end: i };
}

/** C11 7.22.1.3: the subject sequence of `strtod`. */
export function parseFloating(bytes: number[]): {
  value: number;
  end: number;
  rangeError: boolean;
} {
  const text = String.fromCharCode(...bytes);
  const lead = /^\s*/.exec(text)![0].length;
  const rest = text.slice(lead);
  const special = /^([+-]?)(inf(?:inity)?|nan(?:\([0-9A-Za-z_]*\))?)/i.exec(
    rest
  );
  if (special !== null) {
    const sign = special[1] === '-' ? -1 : 1;
    const value = /^n/i.test(special[2]) ? NaN : sign * Infinity;
    return { value, end: lead + special[0].length, rangeError: false };
  }
  const hex =
    /^([+-]?)0[xX](?:([0-9a-fA-F]+)\.?([0-9a-fA-F]*)|\.([0-9a-fA-F]+))(?:[pP]([+-]?\d+))?/.exec(
      rest
    );
  if (hex !== null) {
    const whole = hex[2] ?? '';
    const fraction = hex[3] ?? hex[4] ?? '';
    let value = 0;
    for (const digit of whole + fraction) {
      value = value * 16 + parseInt(digit, 16);
    }
    const exponent =
      (hex[5] === undefined ? 0 : Number(hex[5])) - 4 * fraction.length;
    value = value * Math.pow(2, exponent) * (hex[1] === '-' ? -1 : 1);
    return {
      value,
      end: lead + hex[0].length,
      rangeError: !Number.isFinite(value),
    };
  }
  const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
  if (decimal === null) {
    return { value: 0, end: 0, rangeError: false };
  }
  // `1e` is the number 1 followed by an `e`: the exponent needs a digit.
  const spelled = decimal[0];
  const value = Number(spelled);
  const nonzero = /[1-9]/.test(spelled.replace(/[eE].*$/, ''));
  return {
    value,
    end: lead + spelled.length,
    rangeError:
      !Number.isFinite(value) ||
      (nonzero && Math.abs(value) < LIBRARY_CONSTANTS.DBL_MIN.value),
  };
}

/** The range of one integer conversion's result type. */
interface IntegerRange {
  min: bigint;
  max: bigint;
  unsigned: boolean;
  /** How the result goes back to the engine. */
  result: (value: number) => unknown;
}

const signedRange = (bits: number): IntegerRange => ({
  min: -(BigInt(1) << BigInt(bits - 1)),
  max: (BigInt(1) << BigInt(bits - 1)) - BigInt(1),
  unsigned: false,
  result: bits <= 32 ? cInt : cWide,
});

const unsignedRange = (bits: number): IntegerRange => ({
  min: BigInt(0),
  max: (BigInt(1) << BigInt(bits)) - BigInt(1),
  unsigned: true,
  result: cWide,
});

const LONG_BITS = LONG_BYTES * 8;

export function installStdlib(global: Scope, host: LibraryHost): void {
  const memory = new Memory(host);
  const define = (name: string, fn: (...args: any[]) => unknown): void =>
    global.setTop(name, fn, 'FUNCTION');

  /** Stores where a conversion stopped through its `char **endptr`. */
  const storeEnd = (
    fn: string,
    endptr: unknown,
    text: StringArg,
    end: number
  ): void => {
    if (typeof endptr === 'undefined' || memory.isNull(endptr)) {
      return;
    }
    const at = memory.pointer(endptr, fn, 'the end pointer');
    memory.region(at, Engine.sizeof('*'), fn, 'the end pointer', true);
    host.write(at, memory.pointerInto(text, end), fn);
  };

  const integerConversion = (
    fn: string,
    range: IntegerRange,
    checked: boolean
  ) =>
    function (s: unknown, endptr?: unknown, base?: unknown): unknown {
      const radix = typeof base === 'undefined' ? 10 : Math.trunc(num(base));
      const text = memory.string(s, fn, 'the string to convert');
      if (radix !== 0 && (radix < 2 || 36 < radix)) {
        if (checked) {
          host.setErrno(EINVAL);
          storeEnd(fn, endptr, text, 0);
        }
        return range.result(0);
      }
      const parsed = parseInteger(text.bytes, radix);
      if (checked) {
        storeEnd(fn, endptr, text, parsed.end);
      }
      let value = parsed.negative ? -parsed.magnitude : parsed.magnitude;
      if (range.unsigned) {
        // C converts a negated subject in the return type: "-1" is the
        // largest value, unless the magnitude itself is out of range.
        if (parsed.magnitude > range.max) {
          if (checked) {
            host.setErrno(ERANGE);
          }
          value = range.max;
        } else if (parsed.negative) {
          value =
            (range.max + BigInt(1) - parsed.magnitude) %
            (range.max + BigInt(1));
        }
      } else if (value > range.max || value < range.min) {
        if (checked) {
          host.setErrno(ERANGE);
        }
        value = value > range.max ? range.max : range.min;
      }
      return range.result(Number(value));
    };

  define('strtol', integerConversion('strtol', signedRange(LONG_BITS), true));
  define('strtoll', integerConversion('strtoll', signedRange(64), true));
  define(
    'strtoul',
    integerConversion('strtoul', unsignedRange(LONG_BITS), true)
  );
  define('strtoull', integerConversion('strtoull', unsignedRange(64), true));

  // `atoi` and friends are `strtol` with base 10, no end pointer and no
  // errno; on overflow C leaves them undefined, and the clamped value is as
  // good an answer as any.
  const ato = (fn: string, bits: number) => {
    const convert = integerConversion(fn, signedRange(bits), false);
    return (s: unknown) => convert(s, undefined, 10);
  };
  define('atoi', ato('atoi', 32));
  define('atol', ato('atol', LONG_BITS));
  define('atoll', ato('atoll', 64));

  define('strtod', (s: unknown, endptr?: unknown) => {
    const text = memory.string(s, 'strtod', 'the string to convert');
    const parsed = parseFloating(text.bytes);
    storeEnd('strtod', endptr, text, parsed.end);
    if (parsed.rangeError) {
      host.setErrno(ERANGE);
    }
    return parsed.value;
  });

  define(
    'atof',
    (s: unknown) =>
      parseFloating(memory.string(s, 'atof', 'the string to convert').bytes)
        .value
  );

  define('abs', (x: unknown) => cInt(Math.abs(Math.trunc(num(x)))));
  define('labs', (x: unknown) =>
    signedRange(LONG_BITS).result(Math.abs(Math.trunc(num(x))))
  );
  define('llabs', (x: unknown) => cWide(Math.abs(Math.trunc(num(x)))));

  /**
   * `div` and `ldiv` return a structure. A library function here returns
   * one value, so the result is written into a structure of its own in the
   * library's part of memory and the call evaluates to that structure's
   * members - which is what a declaration or an assignment copies from, and
   * what `.quot` reads through.
   */
  const quotient = (fn: string, type: string) => {
    const descriptor = global.setCode(0, type);
    const quot = global.setCode(0, RECORD_TYPEDEFS[type].memberType);
    const rem = global.setCode(0, RECORD_TYPEDEFS[type].memberType);
    global.objectOnMemory.set(descriptor, quot);
    const result =
      RECORD_TYPEDEFS[type].memberType === 'int'
        ? cInt
        : signedRange(LONG_BITS).result;
    return (numerator: unknown, denominator: unknown): number => {
      const n = Math.trunc(num(numerator));
      const d = Math.trunc(num(denominator));
      if (d === 0) {
        host.refuse(
          'division-by-zero',
          `${fn} was asked to divide by zero, which C leaves undefined`
        );
      }
      const q = Math.trunc(n / d);
      global.objectOnMemory.set(quot, result(q));
      global.objectOnMemory.set(rem, result(n - q * d));
      return quot;
    };
  };
  for (const type of Object.keys(RECORD_TYPEDEFS)) {
    const members = new Map<string, [number, string, number]>();
    const memberType = RECORD_TYPEDEFS[type].memberType;
    RECORD_TYPEDEFS[type].members.forEach((member, i) =>
      members.set(member, [
        i * Engine.sizeof(memberType),
        memberType,
        Engine.sizeof(memberType),
      ])
    );
    // On the code segment, as a system entry: a structure type is not an
    // object, and filing it on the stack would move every frame.
    global.setSystemVariable('CLASS', type, members);
  }
  define('div', quotient('div', 'div_t'));
  define('ldiv', quotient('ldiv', 'ldiv_t'));

  /** The C standard's sample generator (C11 7.22.2.2), seeded with 1. */
  let next = 1;
  define('rand', () => {
    next = (Math.imul(next, 1103515245) + 12345) >>> 0;
    return cInt(Math.floor(next / 65536) % 32768);
  });
  define('srand', (seed: unknown) => {
    next = Math.trunc(num(seed)) >>> 0;
  });

  /**
   * A block whose every byte is zero. Built on the `malloc` wrapper, so the
   * block lands where `malloc` would put it and starts out typed the way
   * `malloc` types it; each cell is then written with its zero, which is
   * what the canvas shows in place of `?`.
   */
  const allocate = global.get('malloc');
  define('calloc', function (this: unknown, n: unknown, size: unknown) {
    const total = sizeArg(n) * sizeArg(size);
    if (0xffffffff < total || typeof allocate !== 'function') {
      return 0;
    }
    const block = allocate.call(this, total);
    if (typeof block !== 'number' || block === 0) {
      return block;
    }
    for (
      let address = block;
      address < global.address.heapAddress;
      address += 1
    ) {
      const type = global.typeOnMemory.get(address);
      if (typeof type === 'undefined' || !global.objectOnMemory.has(address)) {
        continue;
      }
      // A record's opening word is the address of its members, not one.
      if (address === block && host.isRecordType(type)) {
        continue;
      }
      host.write(
        address,
        decodeValue(new Array(Engine.sizeof(type)).fill(0), type),
        'calloc'
      );
    }
    return block;
  });

  /**
   * `exit` as upstream defines it, plus the status on the console when it
   * is not success: a terminal would not say, but a reader stepping through
   * a program that ends early wants to know it was told to.
   */
  define('exit', (status: unknown) => {
    const code = Math.trunc(num(status));
    const name = code === EXIT_FAILURE ? ' (EXIT_FAILURE)' : '';
    host.terminate(
      code,
      code === 0 ? '' : `[exit] the program ended with status ${code}${name}\n`
    );
  });
}
