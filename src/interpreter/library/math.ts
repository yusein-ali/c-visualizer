import { Engine } from 'unicoen.ts/dist/interpreter/Engine/Engine';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { LIBRARY_CONSTANTS } from './constants';
import { LibraryHost } from './host';
import { Memory, cInt, num } from './memory';

/**
 * `<math.h>`, every function a program can call.
 *
 * The upstream set is replaced as well as extended, because several of its
 * answers were wrong rather than missing: `round(-2.5)` gave -2 (C rounds
 * halfway cases away from zero), `rint` threw, `fdim(-5, 3)` gave 2, and
 * `fmax(NAN, 1)` gave NaN. Each function sets `errno` the way glibc does
 * (`math_errhandling & MATH_ERRNO`): `EDOM` when finite arguments produce a
 * NaN, `ERANGE` when they produce an infinity - `sqrt(-1)`, `log(0)`,
 * `exp(1000)`.
 *
 * `isnan`, `isinf`, `isfinite` and `signbit` are macros in C and functions
 * here; a program cannot tell the difference. `fma` multiplies and adds in
 * two roundings, not one: JavaScript has no fused operation.
 */

const EDOM = LIBRARY_CONSTANTS.EDOM.value;
const ERANGE = LIBRARY_CONSTANTS.ERANGE.value;

/** Round half to even: the default rounding direction `rint` uses. */
const roundHalfEven = (x: number): number => {
  if (!Number.isFinite(x)) {
    return x;
  }
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) {
    return floor === 0 && x < 0 ? -0 : floor;
  }
  if (diff > 0.5) {
    return floor + 1;
  }
  return floor % 2 === 0 ? floor : floor + 1;
};

/** Whether a number carries the sign bit, -0 and negative NaN aside. */
const negative = (x: number): boolean => x < 0 || Object.is(x, -0);

/** x * 2^e without overflowing the intermediate power. */
const scale = (x: number, e: number): number => {
  let value = x;
  let exponent = Math.trunc(e);
  while (exponent > 1000) {
    value *= Math.pow(2, 1000);
    exponent -= 1000;
  }
  while (exponent < -1000) {
    value *= Math.pow(2, -1000);
    exponent += 1000;
  }
  return value * Math.pow(2, exponent);
};

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  acos: Math.acos,
  asin: Math.asin,
  atan: Math.atan,
  atan2: Math.atan2,
  cos: Math.cos,
  sin: Math.sin,
  tan: Math.tan,
  cosh: Math.cosh,
  sinh: Math.sinh,
  tanh: Math.tanh,
  acosh: Math.acosh,
  asinh: Math.asinh,
  atanh: Math.atanh,
  exp: Math.exp,
  exp2: (x) => Math.pow(2, x),
  expm1: Math.expm1,
  log: Math.log,
  log10: Math.log10,
  log1p: Math.log1p,
  log2: Math.log2,
  cbrt: Math.cbrt,
  sqrt: Math.sqrt,
  fabs: Math.abs,
  hypot: Math.hypot,
  pow: Math.pow,
  ceil: Math.ceil,
  floor: Math.floor,
  trunc: Math.trunc,
  round: (x) => (negative(x) ? -Math.round(-x) : Math.round(x)),
  rint: roundHalfEven,
  nearbyint: roundHalfEven,
  fdim: (x, y) =>
    Number.isNaN(x) || Number.isNaN(y) ? NaN : x > y ? x - y : 0,
  fmax: (x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.max(x, y)),
  fmin: (x, y) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : Math.min(x, y)),
  fmod: (x, y) => x % y,
  remainder: (x, y) => {
    if (y === 0 || !Number.isFinite(x) || Number.isNaN(y)) {
      return NaN;
    }
    if (!Number.isFinite(y)) {
      return x;
    }
    const r = x - roundHalfEven(x / y) * y;
    return r === 0 ? (negative(x) ? -0 : 0) : r;
  },
  copysign: (x, y) => (negative(y) ? -Math.abs(x) : Math.abs(x)),
  fma: (x, y, z) => x * y + z,
  ldexp: scale,
};

export function installMath(global: Scope, host: LibraryHost): void {
  const memory = new Memory(host);
  const define = (name: string, fn: (...args: any[]) => unknown): void =>
    global.setTop(name, fn, 'FUNCTION');

  /** A function of doubles, reporting a domain or a range error. */
  const checked =
    (compute: (...args: number[]) => number) =>
    (...args: unknown[]): number => {
      const xs = args.map(num);
      const result = compute(...xs);
      if (xs.every((x) => Number.isFinite(x))) {
        if (Number.isNaN(result)) {
          host.setErrno(EDOM);
        } else if (!Number.isFinite(result)) {
          host.setErrno(ERANGE);
        }
      }
      return result;
    };

  for (const [name, compute] of Object.entries(FUNCTIONS)) {
    define(name, checked(compute));
  }

  /** Stores through a pointer argument of the given pointee type. */
  const store = (
    fn: string,
    pointer: unknown,
    type: string,
    value: unknown
  ): void => {
    const at = memory.pointer(pointer, fn, 'the pointer argument');
    memory.region(at, Engine.sizeof(type), fn, 'the pointer argument', true);
    host.write(at, value, fn);
  };

  define('modf', (value: unknown, iptr: unknown) => {
    const x = num(value);
    const whole = Number.isFinite(x) ? Math.trunc(x) : x;
    store('modf', iptr, 'double', whole);
    if (Number.isNaN(x)) {
      return x;
    }
    return Number.isFinite(x) ? x - whole : negative(x) ? -0 : 0;
  });

  define('frexp', (value: unknown, exp: unknown) => {
    const x = num(value);
    if (x === 0 || !Number.isFinite(x)) {
      store('frexp', exp, 'int', cInt(0));
      return x;
    }
    let exponent = Math.floor(Math.log2(Math.abs(x))) + 1;
    let mantissa = scale(x, -exponent);
    // log2 rounds near powers of two; settle the mantissa into [0.5, 1).
    while (Math.abs(mantissa) >= 1) {
      mantissa /= 2;
      exponent += 1;
    }
    while (Math.abs(mantissa) < 0.5) {
      mantissa *= 2;
      exponent -= 1;
    }
    store('frexp', exp, 'int', cInt(exponent));
    return mantissa;
  });

  define('isnan', (x: unknown) => cInt(Number.isNaN(num(x)) ? 1 : 0));
  define('isinf', (x: unknown) => {
    const value = num(x);
    return cInt(value === Infinity ? 1 : value === -Infinity ? -1 : 0);
  });
  define('isfinite', (x: unknown) => cInt(Number.isFinite(num(x)) ? 1 : 0));
  define('signbit', (x: unknown) => cInt(negative(num(x)) ? 1 : 0));
}
