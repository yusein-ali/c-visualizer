/**
 * The type names the C library declares, and the data model they are drawn
 * from.
 *
 * Pure data with no engine import, so the canvas (`core/variables.ts`), the
 * lint and the syntax-error heuristics can ask "is this word a type?" without
 * pulling the interpreter into their bundle.
 *
 * The data model is the engine's, not a real machine's. unicoen.ts gives
 * `int`, `long` and every pointer four bytes (`Engine.sizeof`), and PLIVET
 * gives `long long` eight (`basicSizeof`): it is an ILP32 implementation, as
 * a 32-bit x86 or ARM target is. The library's widths follow it, so that
 * `sizeof(size_t) == sizeof(void *)` and `LONG_MAX` is what a `long` on the
 * canvas can actually hold. Moving the engine to LP64 is a change to all of
 * those at once; when it happens, `DATA_MODEL` is the one line to flip here.
 */

import {
  ENGINE_LONG_LONG,
  ENGINE_UNSIGNED_LONG_LONG,
} from '../ExpressionTypes';
import type { RuntimeRecordTypes } from '../RecordTable';
import { mask } from '../scan';

export type DataModel = 'ILP32' | 'LP64';

export const DATA_MODEL = 'ILP32' as DataModel;

/** Bytes in a `long`, a pointer, and therefore a `size_t`. */
export const LONG_BYTES = DATA_MODEL === 'LP64' ? 8 : 4;

/** One type a library header declares with `typedef`. */
export interface LibraryTypedef {
  header: string;
  /** What it is a name for, spelled as C spells it. */
  underlying: string;
  /** Whether arithmetic on it is unsigned. */
  unsigned: boolean;
  /** Whether it is a pointer type rather than an integer one (`va_list`). */
  pointer?: boolean;
  /** Bytes, in this engine's data model. */
  bytes: number;
  /**
   * The type as the engine spells it (`unsignedchar`), for a typedef narrower
   * or wider than the engine's default of four bytes. The engine is given
   * `typedef <engineType> <name>` before the program's first declaration (see
   * `installLibraryTypedefs`), so its own sizes - the stride of an array, the
   * step of a pointer - follow the width, as they do for a typedef the program
   * writes itself. Left out, the engine sizes the name as four bytes, which is
   * the width of every other entry here.
   */
  engineType?: string;
  /** The one-line description the editor shows. */
  description: string;
}

/**
 * One exact-width integer type of `<stdint.h>`, as glibc declares it for a
 * 32-bit target: what the data model here is.
 */
const exactWidth = (
  name: string,
  underlying: string,
  engineType: string,
  bytes: number
): LibraryTypedef => {
  const unsigned = underlying.startsWith('unsigned');
  return {
    header: 'stdint.h',
    underlying,
    unsigned,
    bytes,
    engineType,
    description: `${unsigned ? 'an unsigned' : 'a signed'} integer type of exactly ${
      bytes * 8
    } bits${unsigned ? '' : ", in two's complement"}; ${name} is ${underlying} here`,
  };
};

/**
 * The scalar typedefs a program may use without declaring them. The two
 * structure types, `div_t` and `ldiv_t`, are records rather than scalars and
 * are listed in `RECORD_TYPEDEFS`.
 */
export const LIBRARY_TYPEDEFS: Record<string, LibraryTypedef> = {
  size_t: {
    header: 'stddef.h',
    underlying: 'unsigned long',
    unsigned: true,
    bytes: LONG_BYTES,
    description:
      'the unsigned integer type of the result of sizeof, and of every object size and count the library takes or returns',
  },
  ptrdiff_t: {
    header: 'stddef.h',
    underlying: 'long',
    unsigned: false,
    bytes: LONG_BYTES,
    description:
      'the signed integer type of the result of subtracting two pointers',
  },
  time_t: {
    header: 'time.h',
    underlying: 'long',
    unsigned: false,
    bytes: LONG_BYTES,
    description:
      'an arithmetic type holding a calendar time, here the number of seconds since 1970-01-01 00:00 UTC',
  },
  clock_t: {
    header: 'time.h',
    underlying: 'long',
    unsigned: false,
    bytes: LONG_BYTES,
    description:
      'an arithmetic type holding processor time, in units of CLOCKS_PER_SEC per second',
  },
  va_list: {
    header: 'stdarg.h',
    underlying: 'char *',
    unsigned: true,
    pointer: true,
    bytes: LONG_BYTES,
    description:
      'the type of the object va_start, va_arg and va_end work through; here a pointer to the next unnamed argument in the frame of the function declared with ...',
  },
  // `<stdint.h>`.
  int8_t: exactWidth('int8_t', 'signed char', 'char', 1),
  uint8_t: exactWidth('uint8_t', 'unsigned char', 'unsignedchar', 1),
  int16_t: exactWidth('int16_t', 'short', 'short', 2),
  uint16_t: exactWidth('uint16_t', 'unsigned short', 'unsignedshort', 2),
  int32_t: exactWidth('int32_t', 'int', 'int', 4),
  uint32_t: exactWidth('uint32_t', 'unsigned int', 'unsignedint', 4),
  int64_t: exactWidth('int64_t', 'long long', ENGINE_LONG_LONG, 8),
  uint64_t: exactWidth(
    'uint64_t',
    'unsigned long long',
    ENGINE_UNSIGNED_LONG_LONG,
    8
  ),
  intmax_t: {
    header: 'stdint.h',
    underlying: 'long long',
    unsigned: false,
    bytes: 8,
    engineType: ENGINE_LONG_LONG,
    description: 'the widest signed integer type; long long here',
  },
  uintmax_t: {
    header: 'stdint.h',
    underlying: 'unsigned long long',
    unsigned: true,
    bytes: 8,
    engineType: ENGINE_UNSIGNED_LONG_LONG,
    description: 'the widest unsigned integer type; unsigned long long here',
  },
  intptr_t: {
    header: 'stdint.h',
    underlying: 'int',
    unsigned: false,
    bytes: LONG_BYTES,
    engineType: 'int',
    description:
      'a signed integer type that can hold any object pointer converted to it and give the same pointer back',
  },
  uintptr_t: {
    header: 'stdint.h',
    underlying: 'unsigned int',
    unsigned: true,
    bytes: LONG_BYTES,
    engineType: 'unsignedint',
    description:
      'an unsigned integer type that can hold any object pointer converted to it and give the same pointer back',
  },
};

/** The structure types the library returns by value. */
export const RECORD_TYPEDEFS: Record<
  string,
  { header: string; members: string[]; memberType: string }
> = {
  div_t: { header: 'stdlib.h', members: ['quot', 'rem'], memberType: 'int' },
  ldiv_t: { header: 'stdlib.h', members: ['quot', 'rem'], memberType: 'long' },
};

/** Every type name the library declares, scalar and record. */
export const LIBRARY_TYPE_NAMES: string[] = Object.keys(
  LIBRARY_TYPEDEFS
).concat(Object.keys(RECORD_TYPEDEFS));

/** A regular-expression alternation of the names, for the source patterns. */
export const LIBRARY_TYPE_PATTERN = LIBRARY_TYPE_NAMES.join('|');

/** Built once: the canvas asks about every variable at every step. */
const LIBRARY_TYPEDEF_WORD = new RegExp(
  `\\b(${Object.keys(LIBRARY_TYPEDEFS).join('|')})\\b`
);

/** The scalar library typedef a type spelling names, or null. */
export function libraryTypedefIn(type: string): LibraryTypedef | null {
  const found = LIBRARY_TYPEDEF_WORD.exec(type);
  return found === null ? null : LIBRARY_TYPEDEFS[found[1]];
}

/**
 * The library typedefs the engine is told about as typedefs of its own: the
 * ones whose width differs from its default (see `engineType`). A name the
 * program has already declared keeps the program's meaning.
 */
export function installLibraryTypedefs(global: {
  typedefList: Map<string, string>;
  setTypedef(oldType: string, newType: string): void;
}): void {
  for (const [name, typedef] of Object.entries(LIBRARY_TYPEDEFS)) {
    if (
      typeof typedef.engineType === 'string' &&
      !global.typedefList.has(name)
    ) {
      global.setTypedef(typedef.engineType, name);
    }
  }
}

/**
 * `div_t` and `ldiv_t` as the canvas's record table describes a structure,
 * so a variable of either is drawn with its two members.
 */
export function libraryRecordTypes(): RuntimeRecordTypes {
  const types: RuntimeRecordTypes = {};
  for (const [name, record] of Object.entries(RECORD_TYPEDEFS)) {
    const width = record.memberType === 'long' ? LONG_BYTES : 4;
    const fields: RuntimeRecordTypes[string]['fields'] = {};
    record.members.forEach((member, i) => {
      fields[member] = {
        offset: i * width,
        engineOffset: i * 4,
        type: record.memberType,
        size: width,
        alignment: width,
        baseQualifiers: [],
        pointerQualifiers: [],
      };
    });
    types[name] = {
      displayType: name,
      kind: 'struct',
      size: record.members.length * width,
      alignment: width,
      fields,
    };
  }
  return types;
}

/**
 * The source the syntax check reads, with each library typedef name spelled
 * as the keyword it stands for, padded to the same width.
 *
 * The check's grammar takes any identifier for a typedef name, and in a cast
 * that loses: `(size_t)n` is read as the parenthesised expression `(size_t)`
 * followed by a stray `n`, and the program is refused. A keyword cannot be
 * read that way. Execution never sees this text - the engine keeps the name,
 * which is what the canvas draws - and a program that declares the name
 * itself keeps its own spelling.
 */
export function typedefsForSyntaxCheck(code: string): string {
  const masked = mask(code);
  const chars = code.split('');
  for (const name of Object.keys(LIBRARY_TYPEDEFS)) {
    if (new RegExp(`\\btypedef\\b[^;]*\\b${name}\\s*;`).test(masked)) {
      continue;
    }
    const keyword = 'long'.padEnd(name.length, ' ');
    const word = new RegExp(`\\b${name}\\b`, 'g');
    let found = word.exec(masked);
    while (found !== null) {
      for (let i = 0; i < name.length; i += 1) {
        chars[found.index + i] = keyword[i];
      }
      found = word.exec(masked);
    }
  }
  return chars.join('');
}
